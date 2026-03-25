# =============================================================
#  PLATAFORMA PFO — Global Service Engenharia  v4.1
#  app.py — Streamlit Web App (Redesenhado)
#
#  Melhorias v4:
#  - Conferência PFO vs WBS Lumina (3 coletores)
#  - Workflow com 3 diretores (aprovação individual)
#  - Comentários registrados por PFO
#  - Análise de desvios (orç vs plan, mês ant vs atual, plan vs real)
#  - Layout profissional modernizado
#  - Upload de WBS junto com PFO
#
#  Melhorias v4.1 (Performance):
#  - Carregamento incremental: PFOs baixados UM POR UM do Drive
#  - Save imediato: cada PFO é gravado no JSON após processamento
#  - PFOs já no JSON nunca são re-baixados do Drive
# =============================================================
import streamlit as st
import os, sys, json, tempfile, shutil, time
from pathlib import Path
from datetime import datetime
try:
    from zoneinfo import ZoneInfo as _ZoneInfo
    _TZ_BRASILIA = _ZoneInfo("America/Sao_Paulo")
except ImportError:
    try:
        import pytz as _pytz
        _TZ_BRASILIA = _pytz.timezone("America/Sao_Paulo")
    except ImportError:
        _TZ_BRASILIA = None
def _agora():
    """Retorna datetime atual no horário de Brasília."""
    if _TZ_BRASILIA:
        return datetime.now(_TZ_BRASILIA).replace(tzinfo=None)
    return _agora()
# TTL para cache do JSON (segundos) — evita chamadas repetidas à API GitHub
_CACHE_TTL = 60
_CACHE_TTL_DRIVE = 1800   # ── PERFORMANCE: TTL para arquivos do Google Drive
_CACHE_TTL_PFO = 1800     # ── PERFORMANCE: TTL para reprocessamento de PFO
# CSS embutido diretamente — sem dependência de styles.py externo
app_styles = None  # não usado mais; CSS está em _get_css_html()
try:
    import ui_components as ui
except (ModuleNotFoundError, KeyError, Exception):
    # Stub mínimo para não quebrar o app se ui_components não existir
    class _UiStub:
        def __getattr__(self, name):
            def _noop(*a, **kw): return ""
            return _noop
    ui = _UiStub()
# ── Ícone do dashboard: tenta "dashboard_icon.png" e o nome legado com typo ──
def _resolve_page_icon() -> str:
    for _icon_name in ("dashboard_icon.png", "deashboard_icon.png"):
        _icon_path = Path(__file__).parent / _icon_name
        if _icon_path.exists():
            return str(_icon_path)
    return "📊"  # fallback emoji se nenhum arquivo existir
# Garante que módulos locais (styles.py, ui_components.py, etc.) sejam encontrados
sys.path.insert(0, str(Path(__file__).parent))
st.set_page_config(page_title="Plataforma PFO — GSE",
    page_icon=_resolve_page_icon(),
    layout="wide", initial_sidebar_state="expanded")
# Lazy imports: módulos pesados só são carregados quando necessários
core = None
agent_service = None
agent_actions = None
agent_ui = None
def _import_core():
    global core
    if core is None:
        import consolidador_pfo as _core
        core = _core
def _import_agents():
    global agent_service, agent_actions, agent_ui
    if agent_service is None:
        try:
            import agent_service as _as, agent_actions as _aa, agent_ui as _au
            agent_service, agent_actions, agent_ui = _as, _aa, _au
        except ModuleNotFoundError:
            pass  # módulos de agente opcionais
# =============================================================
#  PERFORMANCE: Cache centralizado e índices auxiliares
# =============================================================
def _cache_key_hash(*args):
    """Gera hash para chave de cache."""
    import hashlib
    return hashlib.md5(str(args).encode()).hexdigest()[:16]
def _dados_ciclo() -> dict:
    """Retorna dados JSON do ciclo atual — UMA ÚNICA chamada por ciclo Streamlit.
    Respeita o TTL do cache para capturar uploads de outros usuários.
    Após inatividade longa (sessão retomada), recarrega automaticamente."""
    agora = time.time()
    ultimo = st.session_state.get("_dados_ciclo_ts", 0)
    tem_cache = "_dados_ciclo" in st.session_state
    ttl_expirado = (agora - ultimo) > _CACHE_TTL
    # Sem cache ou TTL expirado → recarregar do GitHub
    if not tem_cache or ttl_expirado:
        dados = _carregar_json()
        if dados:  # só atualiza se retornou dados válidos
            st.session_state["_dados_ciclo"] = dados
            st.session_state["_dados_ciclo_ts"] = agora
        elif not tem_cache:
            st.session_state["_dados_ciclo"] = {}
            st.session_state["_dados_ciclo_ts"] = agora
    return st.session_state.get("_dados_ciclo", {})
def _invalidar_cache_ciclo():
    """Invalida caches do ciclo — chamar após qualquer _salvar_json()."""
    for k in list(st.session_state.keys()):
        if k.startswith(("_dados_ciclo", "_idx_", "_dash_kpis_", "_pfos_")):
            st.session_state.pop(k, None)
    # Resetar timestamp para forçar recarga imediata
    st.session_state["_dados_ciclo_ts"] = 0
def _get_idx_arq_cc(dados=None):
    """Índice arquivo->centro de custo. Construído uma vez por ciclo."""
    if "_idx_arq_cc" in st.session_state:
        return st.session_state["_idx_arq_cc"]
    if dados is None:
        dados = _dados_ciclo()
    centros = dados.get("centros_custo", {})
    arq_cc = {}
    for cod, cc in centros.items():
        pfo_arq = cc.get("arquivos", {}).get("pfo", {}).get("nome", "")
        if pfo_arq:
            arq_cc[pfo_arq] = cod
        for mes, mes_info in cc.get("pfo_mensal", {}).items():
            arq_pfo = mes_info.get("arquivo_pfo", "")
            if arq_pfo:
                arq_cc[arq_pfo] = cod
    st.session_state["_idx_arq_cc"] = arq_cc
    return arq_cc
def _is_backoffice_cached(p, centros=None):
    """Verifica se PFO é backoffice usando índice cacheado."""
    arq_cc = _get_idx_arq_cc()
    arq_nome = os.path.basename(p["arquivo"])
    cc_cod = arq_cc.get(arq_nome)
    if centros is None:
        centros = _dados_ciclo().get("centros_custo", {})
    if cc_cod and cc_cod in centros:
        return centros[cc_cod].get("eh_backoffice", False)
    _import_core()
    return core.is_gse(p["arquivo"])
def _pfos_upload_hash(dados=None):
    """Hash dos metadados de upload — detecta se reprocessamento é necessário."""
    if dados is None:
        dados = _dados_ciclo()
    centros = dados.get("centros_custo", {})
    parts = []
    for cod in sorted(centros.keys()):
        cc = centros[cod]
        if cc.get("status") != "ativo" or not cc.get("requer_pfo", True):
            continue
        arqs = cc.get("arquivos", {}).get("pfo", {})
        parts.append(f"{cod}:{arqs.get('upload_em','')}")
    return _cache_key_hash(*parts)
def _pfos_upload_hash_ccs(dados, ccs: list):
    """Hash apenas dos CCs especificados — para cache filtrado por usuário."""
    centros = dados.get("centros_custo", {})
    parts = []
    for cod in sorted(ccs):
        cc = centros.get(cod, {})
        if cc.get("status") != "ativo" or not cc.get("requer_pfo", True):
            continue
        arqs = cc.get("arquivos", {}).get("pfo", {})
        parts.append(f"{cod}:{arqs.get('upload_em','')}")
    return _cache_key_hash(*parts)
# =============================================================
#  LOGO — carregada do arquivo físico em runtime
# =============================================================
def _load_logo_b64() -> str:
    """Lê o arquivo logo.png do repositório e retorna base64.
    Garante que a constante gigante não fique embutida no código."""
    import base64
    for _name in ("logo.png", "Logo.png", "LOGO.png"):
        _path = Path(__file__).parent / _name
        if _path.exists():
            try:
                return base64.b64encode(_path.read_bytes()).decode()
            except Exception:
                pass
    return ""  # fallback: sem logo
def LOGO_B64():  # compatibilidade: mantém nome mas vira chamada de função
    """Deprecado — use _load_logo_b64()."""
    return _load_logo_b64()
# =============================================================
#  USUÁRIOS — gerenciados pelo Admin
#  alcada: "viewer"|"gestor"|"validador"|"diretor"|"admin"
# =============================================================
USUARIOS_DEFAULT = {
    "paulo.bergamo":  {"senha":"gse2026","nome":"Paulo Bérgamo",   "alcada":"admin",     "centros_custo":["*"]},
    "validador":      {"senha":"val2026","nome":"Validador GSE",   "alcada":"validador", "centros_custo":["*"]},
    "gestor":         {"senha":"pfo2026","nome":"Gestor GSE",      "alcada":"gestor",    "centros_custo":["*"]},
    "joao.fernandes":  {"senha":"dir2026","nome":"João Fernandes",  "alcada":"diretor",   "centros_custo":["*"]},
    "samuel.toniello": {"senha":"dir2026","nome":"Samuel Toniello", "alcada":"diretor",   "centros_custo":["*"]},
}
ALCADA_LABEL = {
    "admin":"🔑 Admin", "diretor":"✅ Diretor Aprovador",
    "validador":"🔍 Validador Custos", "gestor":"📁 Gestor",
    "viewer":"👁 Visualização",
}
ALCADA_DESC = {
    "viewer":"1 — Somente visualização", "gestor":"2 — Upload e publicação",
    "validador":"3 — Pode validar", "diretor":"4 — Pode aprovar (3 diretores)",
    "admin":"5 — Admin (acesso total)",
}
# Aprovadores fixos — apenas estes logins aparecem no fluxo de aprovação
# Admin é incluído automaticamente pois pode aprovar como diretor executivo
APROVADORES_PFO = ["joao.fernandes", "samuel.toniello", "paulo.bergamo"]
# Parâmetros configuráveis
PARAMS = {
    "meta_backoffice": 0.07,
    "du_upload": 5, "du_validacao": 8, "du_aprovacao": 10,
    "n_diretores": 3,
}
def _get_usuarios() -> dict:
    """Retorna usuários sempre com dados persistidos do JSON.
    USUARIOS_DEFAULT só é usado como fallback para usuários que NÃO existem no JSON.
    Dados salvos (senhas redefinidas, usuários criados) NUNCA são sobrescritos."""
    if "_usuarios" in st.session_state:
        return st.session_state["_usuarios"]
    # Primeira chamada: tentar local antes de ir ao GitHub
    import copy
    # Tenta carregar do cache local primeiro (sem hit na rede)
    dados_local = st.session_state.get("_dados_local")
    if dados_local and dados_local.get("usuarios"):
        salvos = dados_local.get("usuarios", {})
        merged = copy.deepcopy(USUARIOS_DEFAULT)
        for login, info in salvos.items():
            if "centros_custo" not in info:
                info["centros_custo"] = merged.get(login, {}).get("centros_custo", ["*"])
            merged[login] = info
        st.session_state["_usuarios"] = merged
        return merged
    dados = _dados_ciclo()  # ── PERFORMANCE: usa cache do ciclo ──
    salvos = dados.get("usuarios", {})
    # Merge: defaults como base, salvos sobrescrevem (preservam senhas redefinidas etc)
    merged = copy.deepcopy(USUARIOS_DEFAULT)
    for login, info in salvos.items():
        # Garantir campos obrigatórios no registro salvo
        if "centros_custo" not in info:
            info["centros_custo"] = merged.get(login, {}).get("centros_custo", ["*"])
        merged[login] = info  # dados salvos sempre têm prioridade
    st.session_state["_usuarios"] = merged
    return merged
def _save_usuarios(u: dict):
    st.session_state["_usuarios"] = u
    dados = _carregar_json(); dados["usuarios"] = u; _salvar_json(dados)
def _pode(acao: str) -> bool:
    a = st.session_state.get("alcada","viewer")
    if a == "admin": return True
    if acao == "ver":      return True
    if acao == "upload":   return a in ("gestor","validador","diretor")
    if acao == "validar":  return a in ("validador",)
    if acao == "aprovar":  return a in ("diretor",)
    if acao == "gerenciar_cc": return False  # somente admin (já retorna True acima)
    if acao == "admin_panel": return False
    return False
def _centros_custo_usuario() -> list:
    """Retorna lista de códigos de CC que o usuário logado pode acessar.
    ['*'] significa acesso a todos."""
    usuario = st.session_state.get("usuario", "")
    alcada = st.session_state.get("alcada", "viewer")
    if alcada == "admin":
        return ["*"]
    usuarios = _get_usuarios()
    u = usuarios.get(usuario, {})
    return u.get("centros_custo", ["*"])
def _usuario_pode_cc(cc_codigo: str) -> bool:
    """Verifica se o usuário logado tem acesso a um centro de custo específico."""
    ccs = _centros_custo_usuario()
    return "*" in ccs or cc_codigo in ccs
def _filtrar_centros_usuario(centros: dict) -> dict:
    """Filtra dicionário de centros de custo pelo acesso do usuário."""
    ccs = _centros_custo_usuario()
    if "*" in ccs:
        return centros
    return {k: v for k, v in centros.items() if k in ccs}
def _filtrar_pfos_usuario(pfos: list) -> list:
    """Filtra lista de PFOs pelo acesso do usuário aos centros de custo.
    Associa cada PFO ao CC que contém seu arquivo no pfo_mensal ou arquivos."""
    ccs = _centros_custo_usuario()
    if "*" in ccs:
        return pfos
    # ── PERFORMANCE: usa índice cacheado ao invés de reconstruir mapa ──
    arq_cc = _get_idx_arq_cc()
    # Filtrar: manter PFOs cujo arquivo pertence a um CC que o usuário pode acessar
    # Se não conseguir associar o PFO a nenhum CC, manter (segurança)
    resultado = []
    for p in pfos:
        nome_arq = p.get("arquivo", "")
        cc_do_pfo = arq_cc.get(nome_arq)
        if cc_do_pfo is None or cc_do_pfo in ccs:
            resultado.append(p)
    return resultado
def _mes_ref_atual() -> str:
    """Retorna chave do mês de referência atual, ex: '2026-03'."""
    return _agora().strftime("%Y-%m")
def _mes_ref_label() -> str:
    """Retorna label legível do mês atual, ex: 'Mar/2026'."""
    MP = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
    now = _agora()
    return f"{MP[now.month-1]}/{now.year}"
def _status_pfo_cc(cc_info: dict, mes_ref: str = None) -> str:
    """Retorna status do PFO para um centro de custo no mês de referência."""
    if not cc_info.get("requer_pfo", True):
        return "nao_requer"
    if mes_ref is None:
        mes_ref = _mes_ref_atual()
    pfo_mensal = cc_info.get("pfo_mensal", {}).get(mes_ref, {})
    status = pfo_mensal.get("status", "pendente")
    # Se reprovado mas tem upload_em mais recente que a reprovação,
    # mostrar como "enviado" (novo upload foi feito)
    if status == "reprovado":
        hist = pfo_mensal.get("historico_status", [])
        # Verificar se o último status no histórico é "enviado" (upload pós-reprovação)
        if hist:
            ultimo = hist[-1]
            if ultimo.get("status") == "enviado":
                return "enviado"
    return status
def _badge_pfo_mensal(status: str) -> str:
    """Badge HTML para status do PFO mensal."""
    m = {
        "nao_requer": "<span class='badge' style='background:#F1F5F9;color:#64748B'>— Não requer</span>",
        "pendente":   "<span class='badge badge-pend'>⏳ Pendente</span>",
        "enviado":    "<span class='badge badge-aguard'>📤 Enviado</span>",
        "validado":   "<span class='badge badge-valid'>🔍 Validado</span>",
        "aprovado":   "<span class='badge badge-aprov'>✅ Aprovado</span>",
        "reprovado":  "<span class='badge badge-reprov'>❌ Reprovado</span>",
    }
    return m.get(status, m["pendente"])
# =============================================================
#  PERSISTÊNCIA — JSON no GitHub
# =============================================================
def _gh():
    try:
        return (st.secrets["GITHUB_TOKEN"],
                st.secrets.get("GITHUB_REPO","gsebergamo/plataforma-pfo"),
                st.secrets.get("GITHUB_PATH","dados/plataforma.json"))
    except: return None,None,None
def _carregar_json() -> dict:
    # Cache com TTL: reutiliza dados locais se dentro do período de validade
    agora = time.time()
    ultimo_fetch = st.session_state.get("_json_fetch_ts", 0)
    if "_dados_local" in st.session_state and (agora - ultimo_fetch) < _CACHE_TTL:
        return st.session_state["_dados_local"]
    token,repo,path = _gh()
    if not token:
        resultado = _carregar_json_local()
        st.session_state["_json_fetch_ts"] = agora
        return resultado
    try:
        import urllib.request, urllib.error
        # Usar Raw API — muito mais rápido e sem limite de 1MB da Contents API
        raw_url = f"https://raw.githubusercontent.com/{repo}/main/{path}"
        req = urllib.request.Request(raw_url,
            headers={"Authorization":f"token {token}",
                     "Cache-Control":"no-cache"})
        with urllib.request.urlopen(req, timeout=8) as r:  # timeout reduzido para falhar rápido
            resultado = json.loads(r.read().decode())
        st.session_state["_dados_local"] = resultado
        st.session_state["_json_fetch_ts"] = agora
        # Buscar SHA em background (necessário apenas para salvar)
        if "_gh_sha" not in st.session_state:
            try:
                req2 = urllib.request.Request(
                    f"https://api.github.com/repos/{repo}/contents/{path}",
                    headers={"Authorization":f"token {token}",
                             "Accept":"application/vnd.github.v3+json"})
                # Usar HEAD-like request: pegar só metadados (sem conteúdo decodificado)
                with urllib.request.urlopen(req2, timeout=5) as r2:
                    meta = json.loads(r2.read())
                st.session_state["_gh_sha"] = meta["sha"]
            except Exception:
                pass  # SHA será buscado quando _salvar_json precisar
        return resultado
    except urllib.error.HTTPError as e:
        if e.code == 404:
            st.session_state.pop("_gh_sha", None)
        resultado = _carregar_json_local()
        st.session_state["_json_fetch_ts"] = agora
        return resultado
    except Exception:
        resultado = _carregar_json_local()
        st.session_state["_json_fetch_ts"] = agora
        return resultado
def _carregar_json_local() -> dict:
    """Fallback: lê dados/plataforma.json local ou session_state."""
    if "_dados_local" in st.session_state and st.session_state["_dados_local"]:
        return st.session_state["_dados_local"]
    try:
        local_path = os.path.join(os.path.dirname(__file__), "dados", "plataforma.json")
        if os.path.exists(local_path):
            with open(local_path, "r", encoding="utf-8") as f:
                dados = json.load(f)
            st.session_state["_dados_local"] = dados
            return dados
    except Exception:
        pass
    return {}
def _salvar_json(dados: dict):
    """Salva dados no GitHub. Retorna (True, '') ou (False, 'mensagem de erro')."""
    # Invalida cache TTL para que próximo _carregar_json() busque dados frescos
    st.session_state["_dados_local"] = dados
    st.session_state["_json_fetch_ts"] = time.time()
    _invalidar_cache_ciclo()  # ── PERFORMANCE: força recarga no próximo ciclo ──
    token,repo,path = _gh()
    if not token:
        return True, ""
    try:
        import base64, urllib.request, urllib.error
        b64 = base64.b64encode(json.dumps(dados,ensure_ascii=False,indent=2).encode()).decode()
        sha = st.session_state.get("_gh_sha")
        body = {"message":f"PFO {_agora().strftime('%Y-%m-%d %H:%M')}","content":b64}
        if sha:
            body["sha"] = sha
        req = urllib.request.Request(
            f"https://api.github.com/repos/{repo}/contents/{path}",
            data=json.dumps(body).encode(),
            headers={"Authorization":f"token {token}","Content-Type":"application/json",
                     "Accept":"application/vnd.github.v3+json"},method="PUT")
        with urllib.request.urlopen(req) as r:
            res = json.loads(r.read())
        st.session_state["_gh_sha"] = res["content"]["sha"]; return True, ""
    except urllib.error.HTTPError as e:
        err_body = ""
        try: err_body = e.read().decode()
        except: pass
        if e.code == 409 or e.code == 422:
            # SHA desatualizado — recarregar SHA e tentar novamente
            try:
                req2 = urllib.request.Request(
                    f"https://api.github.com/repos/{repo}/contents/{path}",
                    headers={"Authorization":f"token {token}","Accept":"application/vnd.github.v3+json"})
                with urllib.request.urlopen(req2) as r2:
                    existing = json.loads(r2.read())
                st.session_state["_gh_sha"] = existing["sha"]
                body["sha"] = existing["sha"]
                req3 = urllib.request.Request(
                    f"https://api.github.com/repos/{repo}/contents/{path}",
                    data=json.dumps(body).encode(),
                    headers={"Authorization":f"token {token}","Content-Type":"application/json",
                             "Accept":"application/vnd.github.v3+json"},method="PUT")
                with urllib.request.urlopen(req3) as r3:
                    res3 = json.loads(r3.read())
                st.session_state["_gh_sha"] = res3["content"]["sha"]; return True, ""
            except Exception as e2:
                st.session_state["_dados_local"] = dados
                return False, f"SHA retry falhou: {e2}"
        st.session_state["_dados_local"] = dados
        return False, f"HTTP {e.code}: {err_body[:200]}"
    except Exception as e:
        st.session_state["_dados_local"] = dados
        return False, f"{type(e).__name__}: {e}"
def _salvar_arquivo_gh(gh_path: str, conteudo: bytes, msg: str = "upload arquivo"):
    """Salva arquivo binário no GitHub via Contents API."""
    token, repo, _ = _gh()
    if not token:
        st.session_state.setdefault("_arquivos_local", {})[gh_path] = conteudo; return True
    try:
        import base64 as b64mod, urllib.request, urllib.error
        b64 = b64mod.b64encode(conteudo).decode()
        # Verificar se já existe (pegar SHA)
        sha = None
        try:
            req = urllib.request.Request(
                f"https://api.github.com/repos/{repo}/contents/{gh_path}",
                headers={"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"})
            with urllib.request.urlopen(req) as r:
                sha = json.loads(r.read()).get("sha")
        except urllib.error.HTTPError:
            pass
        body = {"message": msg, "content": b64}
        if sha: body["sha"] = sha
        req = urllib.request.Request(
            f"https://api.github.com/repos/{repo}/contents/{gh_path}",
            data=json.dumps(body).encode(),
            headers={"Authorization": f"token {token}", "Content-Type": "application/json",
                     "Accept": "application/vnd.github.v3+json"}, method="PUT")
        with urllib.request.urlopen(req) as r:
            json.loads(r.read())
        return True
    except:
        st.session_state.setdefault("_arquivos_local", {})[gh_path] = conteudo; return False
def _carregar_arquivo_gh(gh_path: str):
    """Baixa arquivo binário do GitHub. Retorna bytes ou None."""
    token, repo, _ = _gh()
    if not token:
        return st.session_state.get("_arquivos_local", {}).get(gh_path)
    try:
        import base64 as b64mod, urllib.request
        req = urllib.request.Request(
            f"https://api.github.com/repos/{repo}/contents/{gh_path}",
            headers={"Authorization": f"token {token}", "Accept": "application/vnd.github.v3+json"})
        with urllib.request.urlopen(req) as r:
            data = json.loads(r.read())
        return b64mod.b64decode(data["content"])
    except:
        return None
# =============================================================
#  PERSISTÊNCIA — Google Drive (Arquivos Binários)
# =============================================================
def _gdrive_service():
    """Retorna cliente autenticado do Google Drive, ou None.
    Não quebra a aplicação se GDRIVE_SERVICE_ACCOUNT não estiver configurado."""
    if "_gdrive_svc" in st.session_state:
        return st.session_state["_gdrive_svc"]
    # Verificar silenciosamente se o secret existe antes de tentar importar
    try:
        _ = st.secrets["GDRIVE_SERVICE_ACCOUNT"]
    except Exception:
        return None  # secret não configurado — Google Drive desabilitado
    try:
        from google.oauth2 import service_account as _gsa
        from googleapiclient import discovery as _gdiscovery
        creds_dict = dict(st.secrets["GDRIVE_SERVICE_ACCOUNT"])
        creds = _gsa.Credentials.from_service_account_info(
            creds_dict, scopes=["https://www.googleapis.com/auth/drive.file"])
        svc = _gdiscovery.build("drive", "v3", credentials=creds, cache_discovery=False)
        st.session_state["_gdrive_svc"] = svc
        return svc
    except Exception:
        return None
def _gdrive_find_or_create_folder(service, folder_name: str, parent_id: str) -> str:
    """Encontra ou cria subpasta no Google Drive. Retorna folder ID."""
    query = (f"name='{folder_name}' and '{parent_id}' in parents "
             f"and mimeType='application/vnd.google-apps.folder' and trashed=false")
    results = service.files().list(q=query, fields="files(id)", spaces="drive",
                                       supportsAllDrives=True, includeItemsFromAllDrives=True).execute()
    files = results.get("files", [])
    if files:
        return files[0]["id"]
    meta = {"name": folder_name, "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id]}
    folder = service.files().create(body=meta, fields="id", supportsAllDrives=True).execute()
    return folder["id"]
def _salvar_arquivo_gdrive(cc_codigo: str, tipo_arq: str, nome_arquivo: str, conteudo: bytes):
    """Upload arquivo para Google Drive. Retorna file_id ou None."""
    service = _gdrive_service()
    if not service:
        st.session_state.setdefault("_arquivos_local", {})[f"{cc_codigo}/{tipo_arq}"] = conteudo
        st.warning(f"⚠️ Google Drive não conectado — {tipo_arq} salvo apenas na sessão.")
        return None
    try:
        import io
        from googleapiclient.http import MediaIoBaseUpload
        root_id = st.secrets["GDRIVE_FOLDER_ID"]
        centros_id = _gdrive_find_or_create_folder(service, "centros", root_id)
        cc_folder_id = _gdrive_find_or_create_folder(service, cc_codigo, centros_id)
        ext = os.path.splitext(nome_arquivo)[1]
        drive_filename = f"{tipo_arq}{ext}"
        query = f"name='{drive_filename}' and '{cc_folder_id}' in parents and trashed=false"
        existing = service.files().list(q=query, fields="files(id)", spaces="drive",
                                          supportsAllDrives=True, includeItemsFromAllDrives=True).execute().get("files", [])
        media = MediaIoBaseUpload(io.BytesIO(conteudo),
                                  mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                  resumable=True)
        if existing:
            file_id = existing[0]["id"]
            service.files().update(fileId=file_id, media_body=media, supportsAllDrives=True).execute()
            return file_id
        else:
            meta = {"name": drive_filename, "parents": [cc_folder_id]}
            result = service.files().create(body=meta, media_body=media, fields="id", supportsAllDrives=True).execute()
            return result["id"]
    except Exception as e:
        st.session_state.setdefault("_arquivos_local", {})[f"{cc_codigo}/{tipo_arq}"] = conteudo
        st.error(f"❌ Erro ao salvar {tipo_arq} no Google Drive: {e}")
        return None
def _carregar_arquivo_gdrive(file_id: str):
    """Baixa arquivo do Google Drive por ID. Retorna bytes ou None.
    ── PERFORMANCE: cache por file_id na sessão ──"""
    if not file_id:
        return None
    cache_key = f"_gdrive_file_{file_id}"
    if cache_key in st.session_state:
        return st.session_state[cache_key]
    service = _gdrive_service()
    if not service:
        return st.session_state.get("_arquivos_local", {}).get(file_id)
    try:
        import io
        from googleapiclient.http import MediaIoBaseDownload
        request = service.files().get_media(fileId=file_id, supportsAllDrives=True)
        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        resultado = buf.getvalue()
        st.session_state[cache_key] = resultado
        return resultado
    except Exception:
        return None
# =============================================================
#  PORTAL PFO — Upload/Download de arquivos PFO versionados
# =============================================================
def _portal_upload_gdrive(cc_codigo: str, nome_arquivo: str, conteudo: bytes):
    """Upload de arquivo PFO versionado para Google Drive. Retorna file_id ou None."""
    service = _gdrive_service()
    if not service:
        st.warning("⚠️ Google Drive não configurado — arquivo não será salvo remotamente. "
                   "Adicione GDRIVE_SERVICE_ACCOUNT nos secrets para habilitar.")
        return None
    try:
        import io
        from googleapiclient.http import MediaIoBaseUpload
        root_id = st.secrets["GDRIVE_FOLDER_ID"]
        portal_id = _gdrive_find_or_create_folder(service, "portal_pfo", root_id)
        cc_folder_id = _gdrive_find_or_create_folder(service, cc_codigo, portal_id)
        ext = os.path.splitext(nome_arquivo)[1]
        mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        if ext.lower() == ".xlsm":
            mime = "application/vnd.ms-excel.sheet.macroEnabled.12"
        elif ext.lower() == ".xls":
            mime = "application/vnd.ms-excel"
        elif ext.lower() == ".pdf":
            mime = "application/pdf"
        media = MediaIoBaseUpload(io.BytesIO(conteudo), mimetype=mime, resumable=True)
        meta = {"name": nome_arquivo, "parents": [cc_folder_id]}
        result = service.files().create(body=meta, media_body=media, fields="id",
                                        supportsAllDrives=True).execute()
        return result["id"]
    except Exception as e:
        st.error(f"❌ Erro ao fazer upload no Google Drive: {e}")
        return None
def _portal_listar_arquivos(cc_codigo: str) -> list:
    """Retorna lista de metadados dos arquivos PFO de um CC no plataforma.json."""
    dados = _dados_ciclo()  # ── PERFORMANCE ──
    portal = dados.get("portal_pfo", {})
    return portal.get(cc_codigo, [])
def _portal_registrar_arquivo(cc_codigo: str, nome_arquivo: str, versao: str,
                               gdrive_id: str, usuario: str):
    """Registra metadados de um arquivo PFO no plataforma.json."""
    dados = _carregar_json()
    portal = dados.setdefault("portal_pfo", {})
    lista = portal.setdefault(cc_codigo, [])
    registro = {
        "nome": nome_arquivo,
        "versao": versao,
        "gdrive_id": gdrive_id,
        "enviado_por": usuario,
        "enviado_em": _agora().strftime("%d/%m/%Y %H:%M:%S"),
    }
    lista.insert(0, registro)  # mais recente primeiro
    _salvar_json(dados)
def _pg_portal_pfo():
    """Página do Portal PFO — upload e download de versões de arquivos PFO."""
    st.markdown("## 📂 Portal PFO")
    st.caption("Upload e download de arquivos PFO versionados por centro de custo.")
    alcada = st.session_state.get("alcada", "viewer")
    usuario = st.session_state.get("usuario", "")
    pode_upload = alcada in ("admin", "diretor", "validador")
    dados = _dados_ciclo()  # ── PERFORMANCE ──
    centros = dados.get("centros_custo", {})
    ativos = {k: v for k, v in centros.items() if v.get("status") == "ativo"}
    centros_usuario = _filtrar_centros_usuario(ativos)
    if not centros_usuario:
        st.info("Nenhum centro de custo disponível para você.")
        return
    # --- Seção de UPLOAD (apenas admin, diretor, validador) ---
    if pode_upload:
        st.markdown("### ⬆️ Enviar nova versão")
        with st.container(border=True):
            opcoes_cc = {cod: f"{cod} — {info.get('nome', '')}" for cod, info in sorted(centros_usuario.items())}
            cc_sel = st.selectbox("Centro de Custo", options=list(opcoes_cc.keys()),
                                  format_func=lambda x: opcoes_cc[x], key="portal_cc_upload")
            if cc_sel:
                cc_info = centros_usuario[cc_sel]
                cc_nome = cc_info.get("nome", "")
                nome_base = f"PFO-{cc_nome}-{_agora().strftime('%d%m%Y')}"
                st.markdown(f"**Nome do arquivo:** `{nome_base}-Vxx`")
                col1, col2 = st.columns([1, 2])
                with col1:
                    versao = st.text_input("Versão (ex: V01, V02)", value="V01",
                                           key="portal_versao", max_chars=10)
                with col2:
                    nome_final = nome_base
                    st.markdown(f"**Arquivo será salvo como:**")
                    st.code(nome_final)
                arquivo = st.file_uploader("Selecione o arquivo PFO",
                                           type=["xlsx", "xlsm", "xls", "pdf"],
                                           key="portal_file_upload")
                if arquivo and st.button("📤 Enviar arquivo", type="primary",
                                          use_container_width=True):
                    ext = os.path.splitext(arquivo.name)[1]
                    nome_completo = f"{nome_final}{ext}"
                    conteudo = arquivo.read()
                    with st.spinner("Enviando arquivo..."):
                        gdrive_id = _portal_upload_gdrive(cc_sel, nome_completo, conteudo)
                    if gdrive_id:
                        _portal_registrar_arquivo(cc_sel, nome_completo, versao,
                                                   gdrive_id, usuario)
                        st.success(f"✅ Arquivo **{nome_completo}** enviado com sucesso!")
                        time.sleep(0.5)
                        st.rerun()
        st.divider()
    # --- Seção de DOWNLOAD ---
    st.markdown("### ⬇️ Arquivos disponíveis")
    portal = dados.get("portal_pfo", {})
    tem_arquivos = False
    for cc_cod in sorted(centros_usuario.keys()):
        arquivos = portal.get(cc_cod, [])
        if not arquivos:
            continue
        tem_arquivos = True
        cc_info = centros_usuario[cc_cod]
        cc_nome = cc_info.get("nome", "")
        with st.expander(f"📁 {cc_cod} — {cc_nome}  ({len(arquivos)} arquivo{'s' if len(arquivos) > 1 else ''})",
                         expanded=False):
            for i, arq in enumerate(arquivos):
                c1, c2, c3, c4 = st.columns([3, 1, 2, 1])
                with c1:
                    st.markdown(f"**{arq['nome']}**")
                with c2:
                    st.caption(f"🏷️ {arq.get('versao', '-')}")
                with c3:
                    st.caption(f"📅 {arq.get('enviado_em', '-')}  •  {arq.get('enviado_por', '-')}")
                with c4:
                    gdrive_id = arq.get("gdrive_id")
                    if gdrive_id:
                        cache_key = f"_portal_dl_{gdrive_id}"
                        if cache_key in st.session_state:
                            st.download_button(
                                label="💾 Salvar",
                                data=st.session_state[cache_key],
                                file_name=arq["nome"],
                                key=f"save_{cc_cod}_{i}")
                        else:
                            if st.button("⬇️", key=f"dl_{cc_cod}_{i}",
                                         help="Preparar download"):
                                with st.spinner("Baixando..."):
                                    conteudo = _carregar_arquivo_gdrive(gdrive_id)
                                if conteudo:
                                    st.session_state[cache_key] = conteudo
                                    time.sleep(0.4)
                                    st.rerun()
                                else:
                                    st.error("Erro ao baixar arquivo.")
                if i < len(arquivos) - 1:
                    st.markdown("---")
    if not tem_arquivos:
        st.info("📭 Nenhum arquivo PFO disponível para seus centros de custo.")
def _carregar_aprovacoes() -> dict:
    return _dados_ciclo().get("aprovacoes",{})
def _carregar_comentarios() -> dict:
    return _dados_ciclo().get("comentarios",{})
def _atualizar_pfo_mensal_cc(dados: dict, novo_status: str):
    """Propaga status do fluxo de aprovação para o pfo_mensal dos centros de custo."""
    mes_ref = _mes_ref_atual()
    centros = dados.get("centros_custo", {})
    for cod, cc in centros.items():
        pfo_mes = cc.get("pfo_mensal", {}).get(mes_ref, {})
        if pfo_mes and pfo_mes.get("status") not in ("aprovado",):
            if pfo_mes.get("status", "pendente") != "pendente":
                cc.setdefault("pfo_mensal", {})[mes_ref]["status"] = novo_status
def _registrar(chave:str, acao:str, motivo:str="", cc_codigo:str=""):
    dados = _carregar_json()
    aprv = dados.get("aprovacoes",{})
    if chave not in aprv:
        aprv[chave] = {"status":"pendente","aprovacoes_diretoria":{}}
    ts = _agora().strftime("%d/%m/%Y %H:%M:%S")
    usuario = st.session_state.get("usuario","")
    nome = st.session_state.get("nome","")
    aprv[chave][acao] = {"usuario":usuario,"nome":nome,"data_hora":ts,"motivo":motivo}
    if "historico_acoes" not in aprv[chave]:
        aprv[chave]["historico_acoes"] = []
    aprv[chave]["historico_acoes"].append({
        "acao": acao, "usuario": usuario, "nome": nome, "data_hora": ts,
        "motivo": motivo, "cc_codigo": cc_codigo, "mes_ref": _mes_ref_atual(),
    })
    novo_status_pfo = None
    if acao == "upload":
        aprv[chave]["status"] = "aguardando_validacao"
        novo_status_pfo = "enviado"
        aprv[chave].pop("validacao", None)
        aprv[chave].pop("reprovacao", None)
        aprv[chave]["aprovacoes_diretoria"] = {}
        if cc_codigo:
            for ch_old, reg_old in aprv.items():
                if ch_old == chave:
                    continue
                if reg_old.get("status") == "reprovado":
                    for hist in reg_old.get("historico_acoes", []):
                        if hist.get("cc_codigo") == cc_codigo:
                            reg_old.pop("reprovacao", None)
                            reg_old["status"] = "substituido"
                            break
    elif acao == "validacao":
        aprv[chave]["status"] = "validado"
        novo_status_pfo = "validado"
    elif acao == "aprovacao_diretor":
        if "aprovacoes_diretoria" not in aprv[chave]:
            aprv[chave]["aprovacoes_diretoria"] = {}
        aprv[chave]["aprovacoes_diretoria"][usuario] = {"nome":nome,"data_hora":ts}
        n_aprovados = len(aprv[chave]["aprovacoes_diretoria"])
        if n_aprovados >= PARAMS["n_diretores"]:
            aprv[chave]["status"] = "aprovado"
            novo_status_pfo = "aprovado"
        else:
            aprv[chave]["status"] = f"aprovado_{n_aprovados}_de_{PARAMS['n_diretores']}"
    elif acao == "reprovacao":
        aprv[chave]["status"] = "reprovado"
        novo_status_pfo = "reprovado"
    dados["aprovacoes"] = aprv
    if cc_codigo and novo_status_pfo:
        centros = dados.get("centros_custo", {})
        if cc_codigo in centros:
            mes_ref = _mes_ref_atual()
            centros[cc_codigo].setdefault("pfo_mensal", {}).setdefault(mes_ref, {})
            centros[cc_codigo]["pfo_mensal"][mes_ref]["status"] = novo_status_pfo
            hist_key = "historico_status"
            cc_pfo = centros[cc_codigo]["pfo_mensal"][mes_ref]
            if hist_key not in cc_pfo:
                cc_pfo[hist_key] = []
            cc_pfo[hist_key].append({
                "status": novo_status_pfo, "data_hora": ts,
                "usuario": usuario, "nome": nome
            })
            dados["centros_custo"] = centros
    _salvar_json(dados)
def _registrar_comentario(chave:str, texto:str):
    dados = _carregar_json()
    coms = dados.get("comentarios",{})
    if chave not in coms: coms[chave] = []
    coms[chave].append({
        "usuario": st.session_state.get("usuario",""),
        "nome": st.session_state.get("nome",""),
        "data_hora": _agora().strftime("%d/%m/%Y %H:%M:%S"),
        "texto": texto,
    })
    dados["comentarios"] = coms
    _salvar_json(dados)
def _chave(arq:str)->str:
    return os.path.splitext(os.path.basename(arq))[0]
# =============================================================
#  CSS — Layout Profissional
# =============================================================
@st.cache_resource
def _get_css_html():
    """CSS embutido — não depende de styles.py externo."""
    return """<style>
.kpi-card {
    background: #FFFFFF !important; border-radius: 12px !important;
    border: 1px solid #E2E8F0 !important; border-left-width: 4px !important;
    padding: 1rem 1.2rem !important; box-shadow: 0 2px 8px rgba(0,0,0,.08) !important;
    color: #0F172A !important; margin-bottom: .6rem;
}
.kpi-label { font-size:.7rem !important; text-transform:uppercase !important;
    letter-spacing:.08em !important; font-weight:700 !important; color:#475569 !important; }
.kpi-row { display:flex !important; justify-content:space-between !important;
    font-size:.85rem !important; color:#334155 !important; margin-bottom:.2rem !important; }
.alert-box { border-radius:8px; padding:.8rem 1rem; margin-bottom:.4rem;
    font-weight:600; font-size:.88rem; color:#FFFFFF !important; }
.alert-critico { background:#7F1D1D !important; border-left:4px solid #DC2626 !important; color:#FFFFFF !important; }
.alert-atencao { background:#78350F !important; border-left:4px solid #D97706 !important; color:#FFFFFF !important; }
.alert-ok { background:#14532D !important; border-left:4px solid #059669 !important; color:#FFFFFF !important; }
.alert-box span { color:#F1F5F9 !important; }
.alert-badge { display:inline-block; padding:.2rem .6rem; border-radius:6px; font-size:.72rem; font-weight:600; margin-right:.3rem; }
.badge-pend { background:#FEF3C7 !important; color:#78350F !important; }
.badge-enviado { background:#DBEAFE !important; color:#1E3A8A !important; }
.badge-valid { background:#EDE9FE !important; color:#4C1D95 !important; }
.badge-aprov { background:#DCFCE7 !important; color:#14532D !important; }
.badge-reprov { background:#FEE2E2 !important; color:#7F1D1D !important; }
.desvio-badge { border-radius:6px; padding:.15rem .45rem; font-size:.75rem; font-weight:700; }
.desvio-critico { background:#7F1D1D !important; color:#FFFFFF !important; }
.desvio-atencao { background:#78350F !important; color:#FFFFFF !important; }
.desvio-positivo { background:#14532D !important; color:#FFFFFF !important; }
.desvio-neutro { background:#1E3A5F !important; color:#FFFFFF !important; }
.step-box { border-radius:8px; padding:.6rem 1rem; margin-bottom:.4rem;
    font-size:.85rem; border-left:4px solid #E2E8F0; background:#F8FAFC; color:#1E293B !important; }
.step-done { border-left-color:#059669 !important; background:#F0FDF4 !important; color:#14532D !important; }
.step-active { border-left-color:#3B82F6 !important; background:#EFF6FF !important; color:#1E3A8A !important; }
.step-pend { border-left-color:#E2E8F0 !important; background:#F8FAFC !important; color:#64748B !important; }
.step-reprov { border-left-color:#DC2626 !important; background:#FEF2F2 !important; color:#7F1D1D !important; }
.custom-table { width:100%; border-collapse:collapse; font-size:.82rem; }
.custom-table th { background:#1E3A5F; color:#FFFFFF; padding:.5rem .8rem;
    text-align:left; font-size:.72rem; text-transform:uppercase; letter-spacing:.06em; }
.custom-table td { padding:.45rem .8rem; border-bottom:1px solid #F1F5F9; color:#1E293B; }
.custom-table tr:hover td { background:#F8FAFC; }
.comment-box { background:#FFFFFF; border:1px solid #E2E8F0; border-radius:8px;
    padding:.7rem 1rem; margin-bottom:.4rem; font-size:.83rem; color:#1E293B !important; }
.portal-card { background:#0F2847; border:1px solid rgba(255,255,255,.1);
    border-radius:14px; padding:1.2rem; text-align:center; color:#FFFFFF; }
.pc-icon { font-size:2rem; display:block; margin-bottom:.5rem; }
.pc-title { font-size:.9rem; font-weight:700; color:#FFFFFF; margin-bottom:.2rem; }
.pc-desc { font-size:.72rem; color:#94A3B8; }
.pending-bar { background:linear-gradient(135deg,#D97706,#F59E0B); border-radius:10px;
    padding:.7rem 1.2rem; color:#1a1a1a !important; font-weight:600; font-size:.88rem; margin-bottom:1rem; }
</style>"""
def _css():
    st.markdown(_get_css_html(), unsafe_allow_html=True)
# =============================================================
#  HELPERS
# =============================================================
def _fmt(v, pct=False):
    if v is None: return "—"
    if pct: return f"{v*100:.1f}%"
    neg = v < 0
    s = f"{abs(v):,.1f}".replace(",","X").replace(".",",").replace("X",".")
    return f"{'−' if neg else ''}R$ {s}"
def _cls(v, mg=False):
    if v is None: return ""
    if mg: return "neg" if v < 0 else ("amb" if v < .07 else "pos")
    return "neg" if v < 0 else "pos"
def _kpi(col, label, valor, pct=False, borda=None):
    cl = _cls(valor, mg=pct); txt = _fmt(valor, pct=pct)
    b = borda or ("#0EA5E9" if cl == "" else
                  ("#059669" if cl == "pos" else
                   ("#DC2626" if cl == "neg" else "#D97706")))
    col.markdown(f"<div class='kpi-card' style='border-left-color:{b}'>"
                 f"<div class='kpi-label'>{label}</div>"
                 f"<div class='kpi-value {cl}'>{txt}</div></div>",
                 unsafe_allow_html=True)
def _sec(t):
    st.markdown(f"<div class='sec-title'>{t}</div>", unsafe_allow_html=True)
def _badge(status):
    m = {
        "pendente":             "<span class='badge badge-pend'>⏳ Pendente</span>",
        "aguardando_validacao": "<span class='badge badge-aguard'>📋 Aguard. Validação</span>",
        "validado":             "<span class='badge badge-valid'>🔍 Validado</span>",
        "aprovado":             "<span class='badge badge-aprov'>✅ Aprovado</span>",
        "reprovado":            "<span class='badge badge-reprov'>❌ Reprovado</span>",
    }
    if status and status.startswith("aprovado_"):
        return f"<span class='badge badge-parcial'>🔄 {status.replace('_',' ').title()}</span>"
    return m.get(status, m["pendente"])
# =============================================================
#  LOGIN
# =============================================================
def _check_login():
    if not st.session_state.get("logado"):
        _tela_login(); st.stop()
def _tela_login():
    _, c, _ = st.columns([1.2, 1.6, 1.2])
    with c:
        ui.render_login_header(_load_logo_b64())
        if st.session_state.get("_modo_redefinir_senha"):
            st.markdown("#### 🔑 Redefinir Senha")
            with st.form("reset_pwd_form"):
                usr_r = st.text_input("👤 Usuário", placeholder="seu.nome")
                pwd_atual = st.text_input("🔒 Senha atual", type="password")
                pwd_nova = st.text_input("🔑 Nova senha", type="password")
                pwd_conf = st.text_input("🔑 Confirmar nova senha", type="password")
                ok_r = st.form_submit_button("Salvar nova senha", use_container_width=True, type="primary")
            if ok_r:
                usuarios = _get_usuarios()
                u = usuarios.get(usr_r.lower().strip())
                if not u or u["senha"] != pwd_atual:
                    st.error("Usuário ou senha atual incorretos.")
                elif not pwd_nova or len(pwd_nova) < 4:
                    st.error("A nova senha deve ter pelo menos 4 caracteres.")
                elif pwd_nova != pwd_conf:
                    st.error("As senhas não coincidem.")
                else:
                    u["senha"] = pwd_nova
                    _save_usuarios(usuarios)
                    st.success("✅ Senha redefinida com sucesso! Faça login com a nova senha.")
                    st.session_state["_modo_redefinir_senha"] = False
                    time.sleep(0.3)
                    st.rerun()
            if st.button("← Voltar ao login", use_container_width=True):
                st.session_state["_modo_redefinir_senha"] = False
                time.sleep(0.4)
                st.rerun()
        else:
            with st.form("login_form"):
                usr = st.text_input("👤 Usuário", placeholder="seu.nome")
                pwd = st.text_input("🔒 Senha", type="password")
                ok = st.form_submit_button("Entrar →", use_container_width=True)
            if ok:
                usuarios = _get_usuarios()
                u = usuarios.get(usr.lower().strip())
                if u and u["senha"] == pwd:
                    st.session_state.update({
                        "logado": True, "usuario": usr.lower().strip(),
                        "nome": u["nome"], "alcada": u["alcada"]
                    })
                    time.sleep(0.3)
                    st.rerun()
                else:
                    st.error("Usuário ou senha incorretos.")
            if st.button("🔑 Redefinir senha", use_container_width=True):
                st.session_state["_modo_redefinir_senha"] = True
                time.sleep(0.4)
                st.rerun()
# =============================================================
#  PROCESSAMENTO
# =============================================================
@st.cache_data(show_spinner=False)
def _processar(arqs: dict) -> list:
    _import_core()
    tmp = tempfile.mkdtemp(); pfos = []
    try:
        for n, c in arqs.items():
            p = os.path.join(tmp, n)
            with open(p, "wb") as f: f.write(c)
            pfos.append(core.ler_pfo(p))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return pfos
def _processar_wbs(arq_bytes, nome):
    """Processa arquivo WBS e retorna lista de items."""
    cache_key = f"_wbs_cache_{_cache_key_hash(arq_bytes, nome)}"
    if cache_key in st.session_state:
        return st.session_state[cache_key]
    _import_core()
    tmp = tempfile.mkdtemp()
    fp = os.path.join(tmp, nome)
    with open(fp, "wb") as f: f.write(arq_bytes)
    try:
        items = core.ler_wbs(fp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    st.session_state[cache_key] = items
    return items
# =============================================================
#  PG: UPLOAD + FLUXO DE APROVAÇÃO
# =============================================================
def _pg_upload():
    if not _pode("upload"):
        st.warning("Você tem acesso somente leitura."); return
    dados    = _dados_ciclo()
    centros  = dados.get("centros_custo", {})
    ativos   = {k: v for k, v in centros.items()
                if v.get("status") == "ativo" and v.get("requer_pfo", True)}
    ativos   = _filtrar_centros_usuario(ativos)
    mes_ref  = _mes_ref_atual()
    mes_label= _mes_ref_label()
    if not ativos:
        st.warning("⚠️ Nenhum centro de custo disponível. Verifique suas permissões.")
        return
    st.markdown("""<style>
    .up-header {
        background: linear-gradient(135deg,#0B2D54 0%,#1A4F8A 60%,#1E6FC4 100%);
        border-radius:14px; padding:1.5rem 2rem; margin-bottom:1.4rem;
        color:#fff; box-shadow:0 4px 16px rgba(11,45,84,.35);
    }
    .up-header h2 { margin:0 0 .25rem; font-size:1.4rem; font-weight:800; color:#fff; }
    .up-header p  { margin:0; font-size:.82rem; opacity:.75; }
    .up-mes-badge {
        display:inline-block; background:rgba(255,255,255,.15);
        border:1px solid rgba(255,255,255,.25); border-radius:20px;
        padding:.2rem .8rem; font-size:.78rem; font-weight:600;
        color:#7DD3FC; margin-top:.6rem;
    }
    .up-section {
        font-size:.68rem; text-transform:uppercase; letter-spacing:.1em;
        font-weight:700; color:#64748B; margin:1.4rem 0 .7rem;
        display:flex; align-items:center; gap:.5rem;
    }
    .up-section::after { content:''; flex:1; height:1px; background:#E2E8F0; }
    .up-file-row {
        display:flex; justify-content:space-between; align-items:center;
        padding:.5rem .8rem; background:#F8FAFC; border-radius:8px;
        border:1px solid #E2E8F0; font-size:.82rem;
    }
    .up-file-name { font-weight:500; color:#1E293B; }
    .up-file-date { font-size:.72rem; color:#94A3B8; }
    </style>""", unsafe_allow_html=True)
    st.markdown(f"""<div class='up-header'>
        <h2>📤 Upload de PFO</h2>
        <p>Envie os arquivos do Forecast para o ciclo vigente</p>
        <div class='up-mes-badge'>📅 Ciclo: {mes_label}</div>
    </div>""", unsafe_allow_html=True)
    st.markdown("<div class='up-section'>🏢 Selecione o Centro de Custo</div>",
                unsafe_allow_html=True)
    lista_ccs = sorted(ativos.items(), key=lambda x: (
        {"aprovado":0,"validado":1,"enviado":2,"reprovado":3,"pendente":4}.get(
            _status_pfo_cc(x[1], mes_ref), 5), x[1]["codigo"]))
    opcoes_map = {}
    for k, v in lista_ccs:
        st_cc = _status_pfo_cc(v, mes_ref)
        ico = {"aprovado":"✅","validado":"🔍","enviado":"📤","reprovado":"❌","pendente":"⏳"}.get(st_cc,"📋")
        opcoes_map[f"{ico} {v['codigo']} — {v['nome']}"] = k
    sel_label = st.selectbox("Centro de Custo", list(opcoes_map.keys()),
        label_visibility="collapsed",
        help="CCs ordenados por status: Aprovados primeiro, Pendentes por último")
    cc_codigo = opcoes_map[sel_label]
    cc_info   = centros[cc_codigo]
    st_pfo_mes= _status_pfo_cc(cc_info, mes_ref)
    pfo_info_m= cc_info.get("pfo_mensal", {}).get(mes_ref, {})
    env_em  = pfo_info_m.get("enviado_em", "")
    env_por = pfo_info_m.get("enviado_por_nome", pfo_info_m.get("enviado_por",""))
    det_extra = ""
    if env_em:
        det_extra = (f"<div style='font-size:.72rem;color:#64748B;margin-top:.5rem'>"
                     f"📅 Enviado em: <strong>{env_em}</strong>"
                     + (f" por <strong>{env_por}</strong>" if env_por else "")
                     + "</div>")
    cor_borda = {"aprovado":"#059669","validado":"#7C3AED","enviado":"#2563EB",
                 "reprovado":"#DC2626","pendente":"#D97706"}.get(st_pfo_mes,"#E2E8F0")
    def _pill_up(status):
        m = {"enviado":("pill-enviado","📤 Enviado"), "validado":("pill-validado","🔍 Validado"),
             "aprovado":("pill-aprovado","✅ Aprovado"), "reprovado":("pill-reprovado","❌ Reprovado"),
             "pendente":("pill-pendente","⏳ Pendente")}
        cls, lbl = m.get(status, ("pill-pendente","⏳ Pendente"))
        return f"<span class='status-pill {cls}'>{lbl}</span>"
    st.markdown(f"""<div style='background:#fff;border:1px solid #E2E8F0;
        border-left:4px solid {cor_borda};border-radius:12px;
        padding:1rem 1.2rem;margin-bottom:1rem;
        box-shadow:0 1px 4px rgba(0,0,0,.05)'>
        <div style='display:flex;justify-content:space-between;align-items:flex-start'>
            <div>
                <div style='font-family:monospace;font-size:.8rem;color:#2563EB;font-weight:700'>
                    {cc_info.get('codigo','')}
                </div>
                <div style='font-size:1rem;font-weight:700;color:#0F172A;margin:.1rem 0'>
                    {cc_info.get('nome','')}
                </div>
            </div>
            <div style='text-align:right'>
                <div style='font-size:.6rem;color:#94A3B8;text-transform:uppercase;
                    letter-spacing:.08em;margin-bottom:.3rem'>Status {mes_label}</div>
                {_pill_up(st_pfo_mes)}
            </div>
        </div>
        {det_extra}
    </div>""", unsafe_allow_html=True)
    arqs_cc = cc_info.get("arquivos", {})
    if arqs_cc:
        st.markdown("<div class='up-section'>📎 Arquivos do Ciclo Atual</div>", unsafe_allow_html=True)
        TIPOS_LABEL = {"pfo":"📄 PFO", "wbs_custos":"📊 WBS Custos",
                       "wbs_mao_de_obra":"👷 WBS Mão de Obra", "wbs_receitas":"💰 WBS Receitas"}
        for tipo_arq, info_arq in arqs_cc.items():
            col_a, col_b = st.columns([5, 1])
            with col_a:
                st.markdown(
                    f"<div class='up-file-row'>"
                    f"<div><span style='color:#64748B;font-size:.72rem'>{TIPOS_LABEL.get(tipo_arq,tipo_arq)}</span><br>"
                    f"<span class='up-file-name'>{info_arq.get('nome','—')}</span></div>"
                    f"<span class='up-file-date'>📅 {info_arq.get('upload_em','—')}</span>"
                    f"</div>", unsafe_allow_html=True)
            with col_b:
                gdrive_id = info_arq.get("gdrive_id")
                arq_bytes = (_carregar_arquivo_gdrive(gdrive_id) if gdrive_id
                             else _carregar_arquivo_gh(info_arq.get("path","")))
                if arq_bytes:
                    st.download_button("⬇️ Baixar", data=arq_bytes,
                                       file_name=info_arq.get("nome","arquivo.xlsx"),
                                       key=f"dl_{cc_codigo}_{tipo_arq}",
                                       use_container_width=True)
    aprv_check       = _carregar_aprovacoes()
    pfo_exist_nome   = arqs_cc.get("pfo", {}).get("nome", "")
    chave_existente  = os.path.splitext(pfo_exist_nome)[0] if pfo_exist_nome else None
    pfo_mensal_info  = cc_info.get("pfo_mensal", {}).get(mes_ref, {})
    status_mensal    = pfo_mensal_info.get("status", "pendente")
    alcada_atual     = st.session_state.get("alcada", "viewer")
    if status_mensal == "aprovado":
        st.markdown(f"""<div style='background:#F0FDF4;border:1px solid #86EFAC;
            border-left:4px solid #059669;border-radius:12px;
            padding:1.2rem 1.4rem;margin-bottom:1rem'>
            <div style='display:flex;align-items:flex-start;gap:.8rem'>
                <div style='font-size:1.5rem'>✅</div>
                <div>
                    <div style='font-weight:700;color:#14532D;font-size:.95rem'>
                        PFO aprovado — ciclo {mes_label} concluído
                    </div>
                    <div style='color:#166534;font-size:.84rem;margin-top:.3rem'>
                        O PFO deste centro de custo já foi <strong>aprovado</strong> pela diretoria
                        neste ciclo. Nenhuma alteração é permitida até a virada do mês.
                    </div>
                    <div style='color:#15803D;font-size:.78rem;margin-top:.5rem;
                        background:#DCFCE7;border-radius:6px;padding:.3rem .6rem;display:inline-block'>
                        📅 Novo upload liberado a partir do próximo ciclo mensal
                    </div>
                </div>
            </div>
        </div>""", unsafe_allow_html=True)
        return
    if status_mensal == "enviado" and alcada_atual not in ("admin", "validador", "diretor"):
        arq_nome = pfo_info_m.get("arquivo_pfo","") or cc_info.get("arquivos",{}).get("pfo",{}).get("nome","")
        st.markdown(f"""<div style='background:#FEF3C7;border:1px solid #FDE68A;
            border-left:4px solid #D97706;border-radius:12px;
            padding:1.2rem 1.4rem;margin-bottom:1rem'>
            <div style='display:flex;align-items:flex-start;gap:.8rem'>
                <div style='font-size:1.5rem'>📤</div>
                <div>
                    <div style='font-weight:700;color:#78350F;font-size:.95rem'>
                        PFO já enviado neste ciclo
                    </div>
                    <div style='color:#92400E;font-size:.84rem;margin-top:.3rem'>
                        O arquivo <strong>{arq_nome or 'PFO'}</strong> já foi enviado em
                        <strong>{env_em}</strong>{(' por ' + env_por) if env_por else ''}.
                    </div>
                    <div style='color:#B45309;font-size:.82rem;margin-top:.6rem;line-height:1.5'>
                        Para realizar um novo upload, é necessário solicitar a
                        <strong>reprovação do PFO</strong> ao Administrador ou Validador.
                    </div>
                </div>
            </div>
        </div>""", unsafe_allow_html=True)
        return
    if status_mensal == "validado" and alcada_atual not in ("admin",):
        st.markdown(f"""<div style='background:#F5F3FF;border:1px solid #DDD6FE;
            border-left:4px solid #7C3AED;border-radius:12px;
            padding:1.2rem 1.4rem;margin-bottom:1rem'>
            <div style='display:flex;align-items:flex-start;gap:.8rem'>
                <div style='font-size:1.5rem'>🔍</div>
                <div>
                    <div style='font-weight:700;color:#4C1D95;font-size:.95rem'>
                        PFO validado — aguardando aprovação da diretoria
                    </div>
                    <div style='color:#5B21B6;font-size:.84rem;margin-top:.3rem'>
                        O PFO já passou pela validação de custos no ciclo {mes_label}.
                        Para substituir o arquivo, solicite a <strong>reprovação</strong>
                        ao Administrador.
                    </div>
                </div>
            </div>
        </div>""", unsafe_allow_html=True)
        return
    if status_mensal == "validado" and alcada_atual == "admin":
        st.markdown(
            "<div class='up-blocked' style='background:#FFFBEB;border-color:#FDE68A;"
            "border-left-color:#D97706;color:#78350F'>"
            "⚠️ Como Administrador, você pode reprovar este PFO para liberar novo upload.</div>",
            unsafe_allow_html=True)
        motivo_rep = st.text_input("Motivo da reprovação", key=f"rep_admin_{cc_codigo}",
                                    placeholder="Informe o motivo...")
        if st.button("❌ Reprovar e Liberar Reupload", key=f"btn_rep_admin_{cc_codigo}",
                     type="secondary", use_container_width=True):
            _registrar(chave_existente, "reprovacao", motivo_rep, cc_codigo=cc_codigo)
            st.success("✅ PFO reprovado. O gestor poderá fazer novo upload.")
            time.sleep(0.4)
            st.rerun()
        return
    st.markdown("<div class='up-section'>📤 Envio de Arquivos</div>", unsafe_allow_html=True)
    if status_mensal == "reprovado":
        st.markdown(
            f"<div style='background:#FEF2F2;border:1px solid #FECACA;"
            f"border-left:4px solid #DC2626;border-radius:10px;padding:.8rem 1rem;"
            f"margin-bottom:.8rem;color:#7F1D1D;font-size:.84rem'>"
            f"❌ <strong>PFO reprovado</strong> — envie um novo arquivo corrigido abaixo.</div>",
            unsafe_allow_html=True)
    st.markdown("**📄 Arquivo PFO** *(obrigatório · .xlsm ou .xlsx)*")
    uploaded_pfo = st.file_uploader("Arquivo PFO", type=["xlsm","xlsx"],
                                     key=f"up_pfo_{cc_codigo}", label_visibility="collapsed")
    st.markdown("**📊 Arquivos WBS** *(opcionais · .xlsx)*")
    cw1, cw2, cw3 = st.columns(3)
    with cw1:
        wbs_custos   = st.file_uploader("WBS Custos", type=["xlsx"],
                                         key=f"wbs_custos_{cc_codigo}", label_visibility="collapsed", help="WBS Custos")
        st.caption("📊 WBS Custos")
    with cw2:
        wbs_mo       = st.file_uploader("WBS Mão de Obra", type=["xlsx"],
                                         key=f"wbs_mo_{cc_codigo}", label_visibility="collapsed", help="WBS Mão de Obra")
        st.caption("👷 WBS Mão de Obra")
    with cw3:
        wbs_receitas = st.file_uploader("WBS Receitas", type=["xlsx"],
                                         key=f"wbs_receitas_{cc_codigo}", label_visibility="collapsed", help="WBS Receitas")
        st.caption("💰 WBS Receitas")
    if uploaded_pfo  is not None: st.session_state[f"_pfo_file_{cc_codigo}"] = uploaded_pfo
    if wbs_custos    is not None: st.session_state[f"_wbs_custos_{cc_codigo}"] = wbs_custos
    if wbs_mo        is not None: st.session_state[f"_wbs_mo_{cc_codigo}"] = wbs_mo
    if wbs_receitas  is not None: st.session_state[f"_wbs_receitas_{cc_codigo}"] = wbs_receitas
    if uploaded_pfo  is None: uploaded_pfo  = st.session_state.get(f"_pfo_file_{cc_codigo}")
    if wbs_custos    is None: wbs_custos    = st.session_state.get(f"_wbs_custos_{cc_codigo}")
    if wbs_mo        is None: wbs_mo        = st.session_state.get(f"_wbs_mo_{cc_codigo}")
    if wbs_receitas  is None: wbs_receitas  = st.session_state.get(f"_wbs_receitas_{cc_codigo}")
    arquivos_ok = bool(uploaded_pfo)
    tem_wbs     = any([wbs_custos, wbs_mo, wbs_receitas])
    if uploaded_pfo:
        wbs_sel = []
        if wbs_custos:   wbs_sel.append("Custos")
        if wbs_mo:       wbs_sel.append("Mão de Obra")
        if wbs_receitas: wbs_sel.append("Receitas")
        msg_wbs = f" + WBS: {', '.join(wbs_sel)}" if wbs_sel else " (sem WBS)"
        st.success(f"✅ **{uploaded_pfo.name}**{msg_wbs} — pronto para publicar")
    elif tem_wbs:
        st.warning("⚠️ Selecione também o arquivo PFO (obrigatório)")
    st.markdown("<br>", unsafe_allow_html=True)
    if st.button("▶ Processar e Publicar", type="primary",
                 use_container_width=True, disabled=not arquivos_ok):
        if not arquivos_ok:
            st.error("Selecione o arquivo PFO antes de processar.")
        else:
            with st.spinner("⏳ Processando e publicando — aguarde..."):
                try:
                    ts = _agora().strftime("%d/%m/%Y %H:%M")
                    arqs_meta = {}
                    for tipo_arq, arq_file in [("pfo", uploaded_pfo), ("wbs_custos", wbs_custos),
                                               ("wbs_mao_de_obra", wbs_mo), ("wbs_receitas", wbs_receitas)]:
                        if arq_file is None: continue
                        conteudo   = arq_file.read()
                        gdrive_id  = _salvar_arquivo_gdrive(cc_codigo, tipo_arq, arq_file.name, conteudo)
                        arqs_meta[tipo_arq] = {"nome": arq_file.name, "gdrive_id": gdrive_id,
                                               "upload_em": ts, "upload_por": st.session_state.get("usuario","")}
                        arq_file.seek(0)
                    pfo_bytes = uploaded_pfo.read(); uploaded_pfo.seek(0)
                    arqs  = {uploaded_pfo.name: pfo_bytes}
                    st.session_state["_arqs_bytes"] = arqs
                    pfos  = _processar(arqs)
                    pfo_dados_serializados = []
                    for p in pfos:
                        try: pfo_dados_serializados.append(_serializar_pfo(p))
                        except Exception as e_ser: st.warning(f"⚠️ Serialização: {e_ser}")
                    wbs_data = {}
                    if wbs_receitas: wbs_data["receita"] = _processar_wbs(wbs_receitas.read(), wbs_receitas.name); wbs_receitas.seek(0)
                    if wbs_custos:   wbs_data["despesa"] = _processar_wbs(wbs_custos.read(), wbs_custos.name);    wbs_custos.seek(0)
                    if wbs_mo:       wbs_data["mo"]      = _processar_wbs(wbs_mo.read(), wbs_mo.name);            wbs_mo.seek(0)
                    st.session_state["_wbs_data"] = wbs_data
                    existentes = st.session_state.get("pfos", []) or []
                    nomes_novos = {p["arquivo"] for p in pfos}
                    mesclados   = [p for p in existentes if p["arquivo"] not in nomes_novos] + pfos
                    st.session_state.pfos = mesclados
                    dados = _carregar_json()
                    dados["pfos"] = mesclados
                    if pfo_dados_serializados:
                        if "pfos_dados" not in dados: dados["pfos_dados"] = {}
                        for pfo_s in pfo_dados_serializados:
                            dados["pfos_dados"][cc_codigo] = pfo_s
                        if not _pfo_dados_tamanho_ok(dados):
                            st.warning("⚠️ JSON próximo do limite — dados salvos apenas no Drive.")
                            dados.pop("pfos_dados", None)
                    if "centros_custo" not in dados: dados["centros_custo"] = centros
                    arqs_ex = dados["centros_custo"][cc_codigo].get("arquivos", {})
                    arqs_ex.update(arqs_meta)
                    dados["centros_custo"][cc_codigo]["arquivos"] = arqs_ex
                    dados["centros_custo"][cc_codigo].setdefault("pfo_mensal", {})[mes_ref] = {
                        "status": "enviado", "enviado_em": ts,
                        "enviado_por": st.session_state.get("usuario",""),
                        "enviado_por_nome": st.session_state.get("nome",""),
                        "arquivo_pfo": uploaded_pfo.name,
                    }
                    json_ok, json_err = _salvar_json(dados)
                    _registrar(_chave(uploaded_pfo.name), "upload", cc_codigo=cc_codigo)
                    st.session_state.pop("_pfos_reprocessados", None)
                    if json_ok:
                        st.success(f"✅ PFO do CC **{cc_codigo}** publicado com sucesso!")
                    else:
                        st.error(f"Erro ao salvar no GitHub: {json_err}")
                    time.sleep(0.8)
                    st.rerun()
                except Exception as e:
                    st.error(f"Erro ao processar: {e}")
# =============================================================
#  PG: CENTROS DE CUSTO
# =============================================================
def _pg_centros_custo():
    dados = _dados_ciclo()
    centros = dados.get("centros_custo", {})
    pode_editar = _pode("gerenciar_cc")
    mes_ref = _mes_ref_atual()
    mes_label = _mes_ref_label()
    ativos = {k: v for k, v in centros.items() if v.get("status") == "ativo"}
    ativos_vis = _filtrar_centros_usuario(ativos)
    n_ativos   = len(ativos_vis)
    n_requer   = sum(1 for v in ativos_vis.values() if v.get("requer_pfo", True))
    n_enviado  = sum(1 for v in ativos_vis.values() if _status_pfo_cc(v, mes_ref) in ("enviado","validado","aprovado"))
    n_validado = sum(1 for v in ativos_vis.values() if _status_pfo_cc(v, mes_ref) in ("validado","aprovado"))
    n_aprovado = sum(1 for v in ativos_vis.values() if _status_pfo_cc(v, mes_ref) == "aprovado")
    pct_envio  = int(n_enviado / n_requer * 100) if n_requer else 0
    st.markdown(f"""<div style='background:linear-gradient(135deg,#0B2D54 0%,#1A4F8A 60%,#1E6FC4 100%);
        border-radius:14px;padding:1.6rem 2rem;margin-bottom:1.4rem;color:#fff;
        box-shadow:0 4px 16px rgba(11,45,84,.35)'>
        <h2 style='margin:0 0 .2rem;font-size:1.5rem;font-weight:800;color:#fff'>🏢 Centros de Custo</h2>
        <p style='margin:0;font-size:.82rem;opacity:.75'>Gestão e acompanhamento — Ciclo <strong style='color:#7DD3FC'>{mes_label}</strong></p>
        <div style='display:grid;grid-template-columns:repeat(5,1fr);gap:.7rem;margin-top:1.2rem'>
            <div style='background:rgba(255,255,255,.1);border-radius:10px;padding:.65rem .9rem;border:1px solid rgba(255,255,255,.15);text-align:center'>
                <div style='font-size:1.5rem;font-weight:800;color:#fff'>{n_ativos}</div><div style='font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.65);font-weight:600;margin-top:.15rem'>CCs Ativos</div></div>
            <div style='background:rgba(255,255,255,.1);border-radius:10px;padding:.65rem .9rem;border:1px solid rgba(255,255,255,.15);text-align:center'>
                <div style='font-size:1.5rem;font-weight:800;color:#fff'>{n_requer}</div><div style='font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.65);font-weight:600;margin-top:.15rem'>Requerem PFO</div></div>
            <div style='background:rgba(255,255,255,.1);border-radius:10px;padding:.65rem .9rem;border:1px solid rgba(255,255,255,.15);text-align:center'>
                <div style='font-size:1.5rem;font-weight:800;color:#fff'>{n_enviado}<span style='font-size:.9rem;opacity:.7'>/{n_requer}</span></div><div style='font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.65);font-weight:600;margin-top:.15rem'>PFO Enviado</div></div>
            <div style='background:rgba(255,255,255,.1);border-radius:10px;padding:.65rem .9rem;border:1px solid rgba(255,255,255,.15);text-align:center'>
                <div style='font-size:1.5rem;font-weight:800;color:#fff'>{n_validado}</div><div style='font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.65);font-weight:600;margin-top:.15rem'>Validados</div></div>
            <div style='background:rgba(255,255,255,.1);border-radius:10px;padding:.65rem .9rem;border:1px solid rgba(255,255,255,.15);text-align:center'>
                <div style='font-size:1.5rem;font-weight:800;color:#fff'>{n_aprovado}</div><div style='font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.65);font-weight:600;margin-top:.15rem'>Aprovados</div></div>
        </div>
    </div>""", unsafe_allow_html=True)
    if ativos_vis:
        def _pill_cc(status):
            m = {"enviado":("pill-enviado","📤 Enviado"),"validado":("pill-validado","🔍 Validado"),
                 "aprovado":("pill-aprovado","✅ Aprovado"),"reprovado":("pill-reprovado","❌ Reprovado"),
                 "pendente":("pill-pendente","⏳ Pendente")}
            cls, lbl = m.get(status, ("pill-pendente","⏳ Pendente"))
            return f"<span class='status-pill {cls}'>{lbl}</span>"
        rows = ""
        for cc in sorted(ativos_vis.values(), key=lambda x: x.get("codigo","")):
            if not cc.get("requer_pfo", True): continue
            st_pfo = _status_pfo_cc(cc, mes_ref)
            pfo_info = cc.get("pfo_mensal", {}).get(mes_ref, {})
            enviado_em  = pfo_info.get("enviado_em", "—")
            enviado_por = pfo_info.get("enviado_por_nome", pfo_info.get("enviado_por","—"))
            rows += (f"<tr><td style='font-family:monospace;font-size:.78rem;color:#2563EB;font-weight:600'>{cc.get('codigo','')}</td>"
                     f"<td style='font-weight:500'>{cc.get('nome','')}</td>"
                     f"<td style='text-align:center'>{_pill_cc(st_pfo)}</td>"
                     f"<td style='font-size:.76rem;color:#475569'>{enviado_em}</td>"
                     f"<td style='font-size:.76rem;color:#475569'>{enviado_por}</td></tr>")
        st.markdown(f"""<div style='background:#fff;border-radius:12px;overflow:hidden;
            border:1px solid #E2E8F0;box-shadow:0 1px 4px rgba(0,0,0,.05)'>
            <table style='width:100%;border-collapse:collapse;font-size:.84rem'>
            <thead><tr style='background:#1E3A5F'>
            <th style='color:#fff;padding:.6rem 1rem;text-align:left;font-size:.68rem;text-transform:uppercase;letter-spacing:.07em;font-weight:700;border-radius:8px 0 0 0'>Código</th>
            <th style='color:#fff;padding:.6rem 1rem;text-align:left;font-size:.68rem;text-transform:uppercase;letter-spacing:.07em;font-weight:700'>Centro de Custo</th>
            <th style='color:#fff;padding:.6rem 1rem;text-align:center;font-size:.68rem;text-transform:uppercase;letter-spacing:.07em;font-weight:700'>Status</th>
            <th style='color:#fff;padding:.6rem 1rem;text-align:left;font-size:.68rem;text-transform:uppercase;letter-spacing:.07em;font-weight:700'>Enviado em</th>
            <th style='color:#fff;padding:.6rem 1rem;text-align:left;font-size:.68rem;text-transform:uppercase;letter-spacing:.07em;font-weight:700;border-radius:0 8px 0 0'>Enviado por</th>
            </tr></thead><tbody>{rows}</tbody></table></div>""", unsafe_allow_html=True)
    if pode_editar:
        st.markdown("### ➕ Novo Centro de Custo")
        with st.form("form_cc", clear_on_submit=True):
            c1, c2 = st.columns(2)
            with c1: codigo = st.text_input("Código Lumina", placeholder="Ex: 50123 ou GSE-001", max_chars=20)
            with c2: nome_cc = st.text_input("Nome do Centro de Custo", placeholder="Ex: Obra Shopping Norte")
            col_cb1, col_cb2, col_cb3 = st.columns(3)
            with col_cb1: requer_pfo = st.checkbox("Requer PFO mensal", value=True)
            with col_cb2: eh_backoffice = st.checkbox("BackOffice", value=False)
            with col_cb3: eh_nao_operacional = st.checkbox("Não Operacional", value=False)
            submit = st.form_submit_button("💾 Cadastrar Centro de Custo", use_container_width=True, type="primary")
        if submit:
            codigo = codigo.strip().upper(); nome_cc = nome_cc.strip()
            if not codigo: st.error("Informe o código Lumina.")
            elif not all(c.isalnum() or c in ("-","_",".") for c in codigo): st.error("Código inválido.")
            elif not nome_cc: st.error("Informe o nome.")
            elif codigo in centros: st.error(f"CC {codigo} já existe.")
            else:
                centros[codigo] = {"codigo": codigo, "nome": nome_cc, "status": "ativo",
                    "requer_pfo": requer_pfo, "eh_backoffice": eh_backoffice,
                    "eh_nao_operacional": eh_nao_operacional,
                    "criado_por": st.session_state.get("usuario",""),
                    "criado_em": _agora().strftime("%d/%m/%Y %H:%M:%S"),
                    "arquivos": {}, "pfo_mensal": {}}
                dados["centros_custo"] = centros
                ok, erro = _salvar_json(dados)
                if ok: st.success(f"✅ CC {codigo} cadastrado!"); time.sleep(0.5); st.rerun()
                else: st.error(f"Falha: {erro}")
    st.markdown("### 📋 Centros de Custo Cadastrados")
    centros_vis = _filtrar_centros_usuario(centros)
    if not centros_vis: st.info("Nenhum centro de custo disponível."); return
    filtro = st.radio("Status", ["Todos","Ativos","Inativos"], horizontal=True, label_visibility="collapsed")
    lista = sorted(centros_vis.values(), key=lambda x: x.get("codigo",""))
    if filtro == "Ativos":   lista = [c for c in lista if c["status"] == "ativo"]
    elif filtro == "Inativos": lista = [c for c in lista if c["status"] == "inativo"]
    for cc in lista:
        cod = cc["codigo"]; requer = cc.get("requer_pfo", True); is_ativo = cc["status"] == "ativo"
        with st.expander(f"{cod} — {cc['nome']}", expanded=False):
            tags = f"{'● Ativo' if is_ativo else '● Inativo'}"
            if requer: tags += " | PFO ✓"
            if cc.get("eh_backoffice"): tags += " | BackOffice"
            if cc.get("eh_nao_operacional"): tags += " | Não Operacional"
            st.caption(tags)
            st.caption(f"Criado por: {cc.get('criado_por','—')} em {cc.get('criado_em','—')}")
            if pode_editar:
                with st.form(f"form_edit_{cod}"):
                    ec1, ec2 = st.columns(2)
                    with ec1: novo_nome = st.text_input("Nome", value=cc["nome"], key=f"edit_nome_{cod}")
                    with ec2: novo_status = st.selectbox("Status", ["ativo","inativo"], index=0 if is_ativo else 1, key=f"edit_status_{cod}")
                    col_e1, col_e2, col_e3 = st.columns(3)
                    with col_e1: novo_requer = st.checkbox("Requer PFO", value=requer, key=f"edit_requer_{cod}")
                    with col_e2: novo_bo = st.checkbox("BackOffice", value=cc.get("eh_backoffice",False), key=f"edit_bo_{cod}")
                    with col_e3: novo_nop = st.checkbox("Não Operacional", value=cc.get("eh_nao_operacional",False), key=f"edit_nao_op_{cod}")
                    salvar = st.form_submit_button("💾 Salvar", use_container_width=True, type="primary")
                if salvar:
                    novo_nome = novo_nome.strip()
                    if not novo_nome: st.error("Nome vazio.")
                    else:
                        centros[cod].update({"nome": novo_nome, "status": novo_status,
                            "requer_pfo": novo_requer, "eh_backoffice": novo_bo,
                            "eh_nao_operacional": novo_nop,
                            "editado_por": st.session_state.get("usuario",""),
                            "editado_em": _agora().strftime("%d/%m/%Y %H:%M:%S")})
                        dados["centros_custo"] = centros
                        ok, erro = _salvar_json(dados)
                        if ok: st.success(f"✅ CC {cod} atualizado!"); time.sleep(0.5); st.rerun()
                        else: st.error(f"Falha: {erro}")
# =============================================================
#  RECONSTRUÇÃO DE PFOs — SERIALIZAÇÃO E CACHE
# =============================================================
def _serializar_pfo(pfo: dict) -> dict:
    """Converte o dict retornado por ler_pfo() para formato armazenável em JSON."""
    import copy
    s = copy.deepcopy(pfo)
    def _limpar(obj):
        if isinstance(obj, dict):
            return {k: _limpar(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_limpar(i) for i in obj]
        if hasattr(obj, 'item'):
            return float(obj.item())
        if isinstance(obj, float):
            import math
            if math.isnan(obj) or math.isinf(obj):
                return 0.0
        return obj
    s = _limpar(s)
    s["_serializado_em"] = _agora().strftime("%d/%m/%Y %H:%M:%S")
    s["_versao"] = "1.0"
    assert "dre" in s and "dist" in s and "meses" in s, "PFO incompleto"
    assert s["dre"].get("receita"), "DRE sem receita"
    json.dumps(s)
    return s
def _pfo_dados_tamanho_ok(dados: dict) -> bool:
    """Verifica se o JSON ainda está dentro do limite seguro do GitHub (800 KB)."""
    try:
        tamanho = len(json.dumps(dados, ensure_ascii=False).encode())
        return tamanho < 800_000
    except Exception:
        return False
def _carregar_pfos_do_json(ccs_filtro: list = None) -> list:
    """Carrega PFOs diretamente do JSON (sem baixar arquivos do Drive).
    Muito mais rápido — usa dados pré-processados no upload."""
    dados = _dados_ciclo()
    pfos_dados = dados.get("pfos_dados", {})
    if not pfos_dados:
        return []
    centros = dados.get("centros_custo", {})
    centros_usuario = _filtrar_centros_usuario(centros)
    resultado = []
    for cc_cod, pfo_serial in pfos_dados.items():
        if cc_cod not in centros_usuario:
            continue
        if ccs_filtro and cc_cod not in ccs_filtro:
            continue
        cc = centros.get(cc_cod, {})
        if cc.get("status") != "ativo":
            continue
        if pfo_serial:
            resultado.append(pfo_serial)
    return resultado
def _carregar_arquivo_cc(cc_info, tipo_arq):
    """Carrega bytes de um arquivo de um centro de custo (GDrive > GitHub > local)."""
    arqs = cc_info.get("arquivos", {})
    info = arqs.get(tipo_arq)
    if not info:
        return None
    gdrive_id = info.get("gdrive_id")
    if gdrive_id:
        return _carregar_arquivo_gdrive(gdrive_id)
    gh_path = info.get("path", "")
    if gh_path:
        cache_key = f"_gh_file_{_cache_key_hash(gh_path)}"
        if cache_key in st.session_state:
            return st.session_state[cache_key]
        resultado = _carregar_arquivo_gh(gh_path)
        if resultado:
            st.session_state[cache_key] = resultado
        return resultado
    return st.session_state.get("_arquivos_local", {}).get(f"{tipo_arq}")
# =============================================================
#  ★ OTIMIZADO v4.1: Carregamento INCREMENTAL com save imediato
# =============================================================
def _reconstruir_pfos_atuais(ccs_filtro: list = None):
    """
    Reconstrói PFOs a partir dos arquivos brutos dos centros de custo.
    v4.1: Salva cada PFO no JSON IMEDIATAMENTE após processar.
    Pula CCs que já têm dados no JSON (não re-baixa do Drive).
    """
    _import_core()
    dados = _dados_ciclo()
    centros = dados.get("centros_custo", {})
    if not centros:
        return None

    centros_permitidos = _filtrar_centros_usuario(centros)
    if ccs_filtro:
        centros_permitidos = {k: v for k, v in centros_permitidos.items()
                              if k in ccs_filtro}

    # Identificar quais CCs já têm dados no JSON
    pfos_dados_existentes = dados.get("pfos_dados", {})

    ccs_com_pfo = [(cod, cc) for cod, cc in centros_permitidos.items()
                   if cc.get("status") == "ativo"
                   and cc.get("requer_pfo", True)
                   and (cc.get("arquivos", {}).get("pfo", {}).get("gdrive_id")
                        or cc.get("arquivos", {}).get("pfo", {}).get("path"))]

    # Separar: já no JSON vs precisam download
    ccs_ja_no_json = [(cod, cc) for cod, cc in ccs_com_pfo if cod in pfos_dados_existentes]
    ccs_faltando = [(cod, cc) for cod, cc in ccs_com_pfo if cod not in pfos_dados_existentes]

    pfos_novos = []

    # 1) Carregar PFOs que já estão no JSON (instantâneo)
    for cod, cc in ccs_ja_no_json:
        pfo_serial = pfos_dados_existentes.get(cod)
        if pfo_serial:
            pfos_novos.append(pfo_serial)

    # 2) Processar os que faltam — UM POR UM com save imediato
    n_total = len(ccs_faltando)
    if n_total == 0:
        return pfos_novos if pfos_novos else None

    erros = []
    n_salvos = 0

    status_container = st.status(
        f"⏳ Processando {n_total} PFO(s) pendentes — um por um...",
        expanded=True
    )
    prog = st.progress(0, text=f"⏳ Preparando (0/{n_total})...")

    for i, (cod, cc) in enumerate(ccs_faltando):
        nome_pfo = cc.get("arquivos", {}).get("pfo", {}).get("nome", f"pfo_{cod}.xlsx")
        prog.progress((i) / n_total,
                      text=f"⏳ ({i+1}/{n_total}): **{cod}** — {nome_pfo}")

        with status_container:
            st.write(f"📥 {i+1}/{n_total}: Baixando **{cod}** — {nome_pfo}...")

        pfo_bytes = _carregar_arquivo_cc(cc, "pfo")
        if not pfo_bytes:
            erros.append(f"{cod}: arquivo não encontrado no Drive")
            continue

        try:
            tmp = tempfile.mkdtemp()
            fp = os.path.join(tmp, nome_pfo)
            with open(fp, "wb") as f:
                f.write(pfo_bytes)
            pfo_data = core.ler_pfo(fp)
        except Exception as e:
            erros.append(f"{cod} ({nome_pfo}): {e}")
            continue
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

        pfos_novos.append(pfo_data)

        # ── SAVE IMEDIATO: gravar este PFO no JSON agora ──
        try:
            pfo_serial = _serializar_pfo(pfo_data)
            dados_save = _carregar_json()
            if "pfos_dados" not in dados_save:
                dados_save["pfos_dados"] = {}
            dados_save["pfos_dados"][cod] = pfo_serial

            if _pfo_dados_tamanho_ok(dados_save):
                ok, err = _salvar_json(dados_save)
                if ok:
                    n_salvos += 1
                    with status_container:
                        st.write(f"✅ {cod} — salvo permanentemente ({n_salvos}/{n_total})")
                else:
                    with status_container:
                        st.write(f"⚠️ {cod} — processado mas erro ao salvar: {err}")
            else:
                with status_container:
                    st.write(f"⚠️ {cod} — JSON próximo do limite")
        except Exception as e_save:
            with status_container:
                st.write(f"⚠️ {cod} — erro ao serializar: {e_save}")

    prog.progress(1.0, text=f"✅ {len(pfos_novos)} PFOs carregados, {n_salvos} salvos no JSON")

    with status_container:
        if erros:
            for err in erros:
                st.write(f"❌ {err}")
        st.write(f"🎉 **{n_salvos} PFO(s) novos salvos** permanentemente. "
                 f"Próximo acesso será instantâneo!")
    status_container.update(
        label=f"✅ {len(pfos_novos)} PFOs carregados ({n_salvos} novos salvos)",
        state="complete"
    )

    return pfos_novos if pfos_novos else None


def _obter_pfos_dashboard(ccs_filtro: list = None):
    """
    Obtém PFOs para o dashboard.
    v4.1 OTIMIZADO:
      1. Cache da sessão (instantâneo)
      2. Dados pré-processados no JSON (rápido — sem Drive)
      3. Só baixa do Drive os que FALTAM no JSON (incremental)
    """
    dados = _dados_ciclo()
    centros_usuario = _filtrar_centros_usuario(dados.get("centros_custo", {}))
    current_hash = _pfos_upload_hash_ccs(dados, list(centros_usuario.keys()))
    cached_hash = st.session_state.get("_pfos_hash")

    # ── Recarregamento seletivo (admin escolheu CCs específicos) ──
    if ccs_filtro:
        pfos_json = _carregar_pfos_do_json(ccs_filtro=ccs_filtro)
        if pfos_json:
            existentes = st.session_state.get("_pfos_reprocessados") or []
            ccs_recarregando = set(ccs_filtro)
            outros = [p for p in existentes
                      if _get_idx_arq_cc(dados).get(
                          os.path.basename(p.get("arquivo",""))) not in ccs_recarregando]
            mesclados = outros + pfos_json
            st.session_state["_pfos_reprocessados"] = mesclados
            st.session_state["_pfos_hash"] = current_hash
            st.session_state["pfos"] = mesclados
            return mesclados
        pfos_drive = _reconstruir_pfos_atuais(ccs_filtro=ccs_filtro)
        if pfos_drive:
            st.session_state["_pfos_reprocessados"] = pfos_drive
            st.session_state["_pfos_hash"] = current_hash
            st.session_state["pfos"] = pfos_drive
        return st.session_state.get("_pfos_reprocessados") or st.session_state.get("pfos")

    # ── Cache hit ──
    if cached_hash == current_hash and "_pfos_reprocessados" in st.session_state:
        return st.session_state["_pfos_reprocessados"]
    if cached_hash == current_hash and st.session_state.get("pfos"):
        return st.session_state["pfos"]

    # ── Carregar do JSON primeiro ──
    pfos_json = _carregar_pfos_do_json()
    pfos_dados_existentes = dados.get("pfos_dados", {})

    # Contar CCs com arquivo no Drive
    ccs_ativos_com_pfo = [cod for cod, cc in centros_usuario.items()
                           if cc.get("status") == "ativo" and cc.get("requer_pfo", True)
                           and cc.get("arquivos", {}).get("pfo", {}).get("gdrive_id")]
    n_ccs_com_drive = len(ccs_ativos_com_pfo)
    n_no_json = sum(1 for cod in ccs_ativos_com_pfo if cod in pfos_dados_existentes)
    n_faltando = n_ccs_com_drive - n_no_json

    # JSON completo — usar direto (RÁPIDO!)
    if pfos_json and n_faltando == 0:
        st.session_state["_pfos_reprocessados"] = pfos_json
        st.session_state["_pfos_hash"] = current_hash
        st.session_state["pfos"] = pfos_json
        return pfos_json

    # JSON parcial ou vazio — carregar APENAS os que faltam
    if n_faltando > 0:
        if pfos_json:
            st.info(f"📊 {n_no_json} PFOs carregados do cache. "
                    f"Faltam **{n_faltando}** — baixando do Drive um por um...")
        else:
            st.info(f"⏳ Nenhum PFO em cache. Baixando **{n_faltando}** do Drive um por um...")

    pfos_drive = _reconstruir_pfos_atuais()

    if pfos_drive:
        st.session_state["_pfos_reprocessados"] = pfos_drive
        st.session_state["_pfos_hash"] = current_hash
        st.session_state["pfos"] = pfos_drive
        return pfos_drive

    if pfos_json:
        return pfos_json

    return st.session_state.get("pfos")
# =============================================================
#  PG: DASHBOARD
# =============================================================
def _pg_dashboard(pfos):
    with st.spinner("⏳ Carregando dashboard..."):
        import plotly.graph_objects as go
    ANO = core.ANO_ATUAL; MP = core.MESES_PT; MR = core.MES_REAL; MA = core.MES_ATUAL
    def _get_dre_val(plist, chave, tipo):
        return sum(p["dre"].get(chave, {}).get(tipo, 0.0) for p in plist)
    def _soma_dist(chave, plist, ano=ANO):
        return sum(pt["valor"] for p in plist for pt in p["dist"].get(chave, []) if pt["ano"] == ano)
    def _soma_dist_mes(chave, plist, mes_fn, ano=ANO):
        return sum(pt["valor"] for p in plist for pt in p["dist"].get(chave, [])
                   if pt["ano"] == ano and mes_fn(pt["mes"]))
    def _serie_acum(chave, plist, ord_k):
        labs = [f"{MP[k[1]-1]}/{str(k[0])[2:]}" for k in ord_k]
        vals = []; acc = 0.0
        for k in ord_k:
            acc += sum(next((pt["valor"] for pt in p["dist"].get(chave, [])
                             if (pt["ano"], pt["mes"]) == k), 0.0) for p in plist)
            vals.append(round(acc, 1))
        return labs, vals
    def _card_html(titulo, linhas):
        rows = ""
        for lb, v, c in linhas:
            rows += f"<div class='dash-row'><span class='label'>{lb}</span><span class='val {c}'>{v}</span></div>"
        return f"<div class='dash-card'><h4>{titulo}</h4>{rows}</div>"
    def _render_dashboard(plist, titulo_scope):
        if not plist:
            st.info("Nenhum PFO encontrado para este filtro."); return
        cont_orc = _get_dre_val(plist, "contrato", "orcado")
        cont_prj = _get_dre_val(plist, "contrato", "projetado")
        if cont_orc == 0 and cont_prj == 0:
            cont_orc = sum(p.get("contrato", {}).get("orcado", 0.0) for p in plist)
            cont_prj = sum(p.get("contrato", {}).get("projetado", 0.0) for p in plist)
        rec_orc  = _get_dre_val(plist, "receita", "orcado")
        rec_prj  = _get_dre_val(plist, "receita", "projetado")
        cus_orc  = _get_dre_val(plist, "custo", "orcado") + _get_dre_val(plist, "cliente", "orcado")
        cus_prj  = _get_dre_val(plist, "custo", "projetado") + _get_dre_val(plist, "cliente", "projetado")
        res_orc  = _get_dre_val(plist, "resultado", "orcado")
        res_prj  = _get_dre_val(plist, "resultado", "projetado")
        if res_orc == 0: res_orc = rec_orc - cus_orc
        if res_prj == 0: res_prj = rec_prj - cus_prj
        mg_orc = res_orc / cont_orc if cont_orc != 0 else 0.0
        mg_prj = res_prj / cont_prj if cont_prj != 0 else 0.0
        imp_orc = _get_dre_val(plist, "impostos", "orcado")
        imp_prj = _get_dre_val(plist, "impostos", "projetado")
        var_cont = ((cont_prj - cont_orc) / cont_orc * 100) if cont_orc else 0
        var_res  = ((res_prj - res_orc) / abs(res_orc) * 100) if res_orc else 0
        cor_mg = "#86EFAC" if mg_prj >= mg_orc else "#FCA5A5"
        cor_res= "#86EFAC" if res_prj >= 0 else "#FCA5A5"
        sinal_v = lambda v: ("+" if v >= 0 else "") + f"{v:.1f}%"
        st.markdown(f"""<div style='background:linear-gradient(135deg,#0B2D54 0%,#1A4F8A 60%,#1E6FC4 100%);
            border-radius:14px;padding:1.5rem 2rem;margin-bottom:1.4rem;color:#fff;box-shadow:0 4px 16px rgba(11,45,84,.35)'>
            <h2 style='margin:0 0 .2rem;font-size:1.4rem;font-weight:800;color:#fff'>📊 Dashboard — {titulo_scope}</h2>
            <p style='margin:0;font-size:.82rem;opacity:.75'>Consolidado — Forecast vs Orçado — <span style='color:#7DD3FC;font-weight:600'>{ANO}</span></p>
            <div style='display:grid;grid-template-columns:repeat(5,1fr);gap:.7rem;margin-top:1.2rem'>
                <div style='background:rgba(255,255,255,.1);border-radius:10px;padding:.65rem .9rem;border:1px solid rgba(255,255,255,.15);text-align:center'>
                    <div style='font-size:1.3rem;font-weight:800;color:#fff'>{_fmt(cont_prj)}</div>
                    <div style='font-size:.62rem;font-weight:400;opacity:.8'>{sinal_v(var_cont)} vs orç</div>
                    <div style='font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.65);font-weight:600;margin-top:.15rem'>Contrato</div></div>
                <div style='background:rgba(255,255,255,.1);border-radius:10px;padding:.65rem .9rem;border:1px solid rgba(255,255,255,.15);text-align:center'>
                    <div style='font-size:1.3rem;font-weight:800;color:#fff'>{_fmt(rec_prj)}</div>
                    <div style='font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.65);font-weight:600;margin-top:.15rem'>Receita</div></div>
                <div style='background:rgba(255,255,255,.1);border-radius:10px;padding:.65rem .9rem;border:1px solid rgba(255,255,255,.15);text-align:center'>
                    <div style='font-size:1.3rem;font-weight:800;color:#fff'>{_fmt(cus_prj)}</div>
                    <div style='font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.65);font-weight:600;margin-top:.15rem'>Custos</div></div>
                <div style='background:rgba(255,255,255,.1);border-radius:10px;padding:.65rem .9rem;border:1px solid rgba(255,255,255,.15);text-align:center'>
                    <div style='font-size:1.3rem;font-weight:800;color:{cor_res}'>{_fmt(res_prj)}</div>
                    <div style='font-size:.62rem;font-weight:400;opacity:.8'>{sinal_v(var_res)} vs orç</div>
                    <div style='font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.65);font-weight:600;margin-top:.15rem'>Resultado</div></div>
                <div style='background:rgba(255,255,255,.1);border-radius:10px;padding:.65rem .9rem;border:1px solid rgba(255,255,255,.15);text-align:center'>
                    <div style='font-size:1.3rem;font-weight:800;color:{cor_mg}'>{_fmt(mg_prj, pct=True)}</div>
                    <div style='font-size:.62rem;font-weight:400;opacity:.8'>Orç: {_fmt(mg_orc, pct=True)}</div>
                    <div style='font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.65);font-weight:600;margin-top:.15rem'>Margem</div></div>
            </div>
        </div>""", unsafe_allow_html=True)
        # KPI Cards
        c1, c2, c3 = st.columns(3)
        with c1:
            st.markdown(_card_html("Total do Contrato", [("Orçado", _fmt(cont_orc), _cls(cont_orc)), ("Forecast", _fmt(cont_prj), _cls(cont_prj))]), unsafe_allow_html=True)
            st.markdown(_card_html("Total de Receita", [("Orçado", _fmt(rec_orc), _cls(rec_orc)), ("Forecast", _fmt(rec_prj), _cls(rec_prj))]), unsafe_allow_html=True)
        with c2:
            st.markdown(_card_html("Total de Custos", [("Orçado", _fmt(cus_orc), _cls(cus_orc)), ("Forecast", _fmt(cus_prj), _cls(cus_prj))]), unsafe_allow_html=True)
            st.markdown(_card_html("Resultado Operacional", [("Orçado", _fmt(res_orc), _cls(res_orc)), ("Forecast", _fmt(res_prj), _cls(res_prj))]), unsafe_allow_html=True)
        with c3:
            st.markdown(_card_html("Margem Operacional", [("Orçado", _fmt(mg_orc, pct=True), "pct"), ("Forecast", _fmt(mg_prj, pct=True), "pct")]), unsafe_allow_html=True)
            imp_pct_orc = imp_orc / rec_orc if rec_orc else 0
            imp_pct_prj = imp_prj / rec_prj if rec_prj else 0
            st.markdown(_card_html("Impostos", [("Orçado", f"{_fmt(imp_orc)} ({imp_pct_orc*100:.1f}%)", _cls(imp_orc)), ("Forecast", f"{_fmt(imp_prj)} ({imp_pct_prj*100:.1f}%)", _cls(imp_prj))]), unsafe_allow_html=True)
        # Consolidado Ano
        st.markdown("<br>", unsafe_allow_html=True)
        _sec(f"📋 Consolidado {ANO}")
        def _sp(ch, mes_fn):
            return sum(pt["valor"] for p in plist for pt in p["dist"].get(ch, [])
                       if pt["ano"] == ANO and mes_fn(pt["mes"]))
        cont_real = _sp("contrato", lambda m: m < MA); cont_plan = _sp("contrato", lambda m: m >= MA); cont_tot = cont_real + cont_plan
        cust_real = _sp("custo", lambda m: m < MA) + _sp("cliente", lambda m: m < MA)
        cust_plan = _sp("custo", lambda m: m >= MA) + _sp("cliente", lambda m: m >= MA); cust_tot = cust_real + cust_plan
        rece_real = _sp("receita", lambda m: m < MA); rece_plan = _sp("receita", lambda m: m >= MA); rece_tot = rece_real + rece_plan
        resu_real = _sp("resultado", lambda m: m < MA); resu_plan = _sp("resultado", lambda m: m >= MA)
        if resu_real == 0 and resu_plan == 0: resu_real = rece_real - cust_real; resu_plan = rece_plan - cust_plan
        resu_tot = resu_real + resu_plan
        marg_real = resu_real / cont_real if cont_real else None
        marg_plan = resu_plan / cont_plan if cont_plan else None
        marg_tot  = resu_tot / cont_tot if cont_tot else None
        impo_real = _sp("impostos", lambda m: m < MA); impo_plan = _sp("impostos", lambda m: m >= MA); impo_tot = impo_real + impo_plan
        def _row_cons(lb, vr, vp, vt, b=False, pct=False):
            s = "font-weight:700;" if b else ""
            if pct:
                return (f"<tr><td style='{s}'>{lb}</td><td style='font-size:.82rem;{s}'>{_fmt(vr, pct=True)}</td>"
                        f"<td style='font-size:.82rem;{s}'>{_fmt(vp, pct=True)}</td><td style='font-size:.82rem;{s}'>{_fmt(vt, pct=True)}</td></tr>")
            return (f"<tr><td style='{s}'>{lb}</td><td class='kpi-value {_cls(vr)}' style='font-size:.82rem;{s}'>{_fmt(vr)}</td>"
                    f"<td class='kpi-value {_cls(vp)}' style='font-size:.82rem;{s}'>{_fmt(vp)}</td>"
                    f"<td class='kpi-value {_cls(vt)}' style='font-size:.82rem;{s}'>{_fmt(vt)}</td></tr>")
        lp = f"Plan.({MP[MA-1]}–Dez)"
        st.markdown(f"""<table class='custom-table'>
        <tr><th>Indicador</th><th>Real(Jan–{MP[MR-1] if MR >= 1 else 'Jan'})</th><th>{lp}</th><th>Total {ANO}</th></tr>
        {_row_cons("Contrato", cont_real, cont_plan, cont_tot)}
        {_row_cons("Custos", cust_real, cust_plan, cust_tot)}
        {_row_cons("Receita", rece_real, rece_plan, rece_tot)}
        {_row_cons("Resultado", resu_real, resu_plan, resu_tot, b=True)}
        {_row_cons("Margem", marg_real, marg_plan, marg_tot, pct=True)}
        {_row_cons("Impostos", impo_real, impo_plan, impo_tot)}
        </table>""", unsafe_allow_html=True)
        # Alertas
        st.markdown("<br>", unsafe_allow_html=True)
        _sec("🚨 Alertas de Resultado")
        rec_acum = _soma_dist_mes("receita", plist, lambda m: m < MA)
        cus_acum = _soma_dist_mes("custo", plist, lambda m: m < MA) + _soma_dist_mes("cliente", plist, lambda m: m < MA)
        res_acum = rec_acum - cus_acum
        if res_acum < 0:
            st.markdown(f"<div style='background:#7F1D1D;border:1px solid #DC2626;border-left:4px solid #DC2626;border-radius:8px;padding:.8rem 1rem;margin-bottom:.4rem;color:#FFFFFF;font-weight:600'>⚠️ ALERTA: Resultado acumulado NEGATIVO ({_fmt(res_acum)})</div>", unsafe_allow_html=True)
        else:
            st.markdown(f"<div style='background:#14532D;border:1px solid #059669;border-left:4px solid #059669;border-radius:8px;padding:.8rem 1rem;margin-bottom:.4rem;color:#FFFFFF;font-weight:600'>✅ Resultado acumulado positivo ({_fmt(res_acum)})</div>", unsafe_allow_html=True)
        # Gráficos Curva S
        st.markdown("<br>", unsafe_allow_html=True)
        _sec("📈 Curvas S — Acumulado Mês a Mês")
        todos_meses = sorted({(pt["ano"], pt["mes"]) for p in plist for pt in p["dist"].get("receita", [])})
        todos_anos = sorted({k[0] for k in todos_meses})
        opcoes_periodo = ["Período Total"] + [str(a) for a in todos_anos]
        col_sel1, _ = st.columns([2, 4])
        with col_sel1:
            periodo_sel = st.selectbox("📅 Competência", opcoes_periodo,
                index=opcoes_periodo.index(str(ANO)) if str(ANO) in opcoes_periodo else 0, key="dash_periodo_graficos")
        if periodo_sel == "Período Total": ord_k = todos_meses
        else: ord_k = [(a, m) for a, m in todos_meses if a == int(periodo_sel)]
        if not ord_k: st.info("Sem dados para o período."); return
        try:
            def _make_scurve(titulo, chaves_traces, plist_src, ord_keys):
                fig = go.Figure()
                labs = [f"{MP[k[1]-1]}/{str(k[0])[2:]}" for k in ord_keys]
                for chave, nome_trace, cor in chaves_traces:
                    _, vals = _serie_acum(chave, plist_src, ord_keys)
                    fig.add_trace(go.Scatter(x=labs, y=vals, name=nome_trace,
                        line=dict(color=cor, width=2.5), mode="lines+markers", marker=dict(size=4)))
                fig.update_layout(title=dict(text=f"Curva S — {titulo} (R$ mil)", font=dict(size=13)), **ui.plotly_theme())
                st.plotly_chart(fig, use_container_width=True)
            cg1, cg2 = st.columns(2)
            with cg1:
                chave_cont = "contrato" if any(p["dist"].get("contrato") for p in plist) else "receita"
                _make_scurve("Contrato", [(chave_cont, "Contrato", "#2563EB")], plist, ord_k)
            with cg2:
                _make_scurve("Custos", [("custo", "Custos", "#DC2626")], plist, ord_k)
            cg3, cg4 = st.columns(2)
            with cg3:
                _make_scurve("Resultado", [("receita", "Receita", "#0EA5E9"), ("custo", "Custo", "#DC2626")], plist, ord_k)
            with cg4:
                fig_res = go.Figure()
                labs_r, vals_r = _serie_acum("receita", plist, ord_k)
                _, vals_c = _serie_acum("custo", plist, ord_k)
                vals_resultado = [round(r - c, 1) for r, c in zip(vals_r, vals_c)]
                fig_res.add_trace(go.Scatter(x=labs_r, y=vals_resultado, name="Resultado Acum.",
                    line=dict(color="#059669", width=3), mode="lines+markers", marker=dict(size=5),
                    fill="tozeroy", fillcolor="rgba(5,150,105,0.08)"))
                fig_res.add_hline(y=0, line_dash="dot", line_color="#94A3B8", line_width=1)
                fig_res.update_layout(title=dict(text="Resultado Acumulado (R$ mil)", font=dict(size=13)), **ui.plotly_theme())
                st.plotly_chart(fig_res, use_container_width=True)
        except Exception as _e_graf:
            st.warning(f"⚠️ Erro nos gráficos: {_e_graf}")
        # Ranking
        st.divider()
        _sec("🏆 Ranking por Resultado Projetado")
        aprv = _carregar_aprovacoes()
        centros_bo = _dados_ciclo().get("centros_custo", {})
        def _is_backoffice(p): return _is_backoffice_cached(p, centros_bo)
        pfos_op_rank = [p for p in plist if not _is_backoffice(p)]
        pfos_r = sorted(pfos_op_rank, key=lambda p: p["dre"]["resultado"]["projetado"], reverse=True)
        rows_rk = ""
        for i, p in enumerate(pfos_r, 1):
            d = p["dre"]; ct = p.get("contrato", {})
            ctp = ct.get("projetado", d["receita"]["projetado"])
            rsp = d["resultado"]["projetado"]; mg = rsp / ctp if ctp else None
            ch = _chave(p["arquivo"])
            rows_rk += (f"<tr><td style='text-align:center'>{i}</td>"
                        f"<td>{core.nome_curto(p['arquivo'], 35)}</td>"
                        f"<td>{_fmt(d['receita']['projetado'])}</td>"
                        f"<td>{_fmt(d['custo']['projetado'])}</td>"
                        f"<td class='kpi-value {_cls(rsp)}' style='font-size:.82rem'>{_fmt(rsp)}</td>"
                        f"<td class='kpi-value {_cls(mg,mg=True)}' style='font-size:.82rem'>{_fmt(mg,pct=True)}</td>"
                        f"<td>{_badge(aprv.get(ch,{}).get('status','pendente'))}</td></tr>")
        st.markdown(f"""<table class='custom-table'>
        <tr><th style='text-align:center'>#</th><th>Projeto</th><th>Rec.Proj.</th>
        <th>Cus.Proj.</th><th>Resultado</th><th>Margem</th><th>Status</th></tr>{rows_rk}</table>""", unsafe_allow_html=True)
        # BackOffice
        pfos_bo_scope = [p for p in plist if _is_backoffice(p)]
        rec_scope = _soma_dist("receita", plist)
        if pfos_bo_scope:
            st.divider()
            meta = PARAMS["meta_backoffice"]
            tot_bo = _soma_dist("custo", pfos_bo_scope) + _soma_dist("cliente", pfos_bo_scope)
            indic = tot_bo / rec_scope if rec_scope else 0
            cor_bo = "#059669" if indic <= meta else "#DC2626"
            bg_bo = "#14532D" if indic <= meta else "#7F1D1D"
            st.markdown(f"<div style='background:{bg_bo};border-radius:10px;padding:1rem 1.5rem;border-left:4px solid {cor_bo};color:#FFFFFF'>"
                f"BackOffice / Faturamento: <strong style='font-size:1.4rem;color:#FFFFFF'>{_fmt(indic,pct=True)}</strong>"
                f"<span style='color:#D1FAE5;margin-left:1.5rem;opacity:.85'>Meta: {meta*100:.1f}%</span></div>", unsafe_allow_html=True)
    # Render principal
    st.markdown(f"<div style='text-align:right;margin-bottom:.5rem'>"
        f"<img src='data:image/png;base64,{_load_logo_b64()}' style='max-height:45px;opacity:.7' /></div>", unsafe_allow_html=True)
    _render_dashboard(pfos, f"Consolidado Empresa — {MP[MA-1]}/{ANO}")
    # Seletor por CC
    st.divider()
    _sec("🔎 Dashboard por Centro de Custo")
    dados = _dados_ciclo()
    centros = dados.get("centros_custo", {})
    centros_permitidos = _filtrar_centros_usuario(centros)
    arq_para_cc = {}
    for cod, cc in centros.items():
        arq_pfo = cc.get("arquivos", {}).get("pfo", {}).get("nome", "")
        if arq_pfo: arq_para_cc[arq_pfo] = cod
        for mes_ref, pfo_info in cc.get("pfo_mensal", {}).items():
            arq_pfo_m = pfo_info.get("arquivo_pfo", "")
            if arq_pfo_m: arq_para_cc[arq_pfo_m] = cod
    pfos_por_cc = {}
    for p in pfos:
        cc_cod = arq_para_cc.get(os.path.basename(p["arquivo"]))
        if cc_cod: pfos_por_cc.setdefault(cc_cod, []).append(p)
    pfos_por_cc = {k: v for k, v in pfos_por_cc.items() if k in centros_permitidos}
    opcoes_cc = ["— Selecione um Centro de Custo —"]
    cc_map = {}
    for cod in sorted(pfos_por_cc.keys()):
        nome_cc = centros.get(cod, {}).get("nome", cod)
        label = f"{cod} — {nome_cc}"; opcoes_cc.append(label); cc_map[label] = cod
    sel_cc = st.selectbox("Centro de Custo", opcoes_cc, key="dash_cc_sel")
    if sel_cc != opcoes_cc[0]:
        cod_sel = cc_map[sel_cc]
        if cod_sel in pfos_por_cc:
            nome_cc = centros.get(cod_sel, {}).get("nome", cod_sel)
            _render_dashboard(pfos_por_cc[cod_sel], f"{cod_sel} — {nome_cc}")
# =============================================================
#  PG: CONFERÊNCIA PFO vs WBS
# =============================================================
def _pg_conferencia(pfos):
    st.markdown("## 🔍 Conferência PFO vs WBS Lumina")
    dados = _dados_ciclo()
    centros = dados.get("centros_custo", {})
    ativos = {k: v for k, v in centros.items() if v.get("status") == "ativo" and v.get("requer_pfo", True)}
    ativos = _filtrar_centros_usuario(ativos)
    if not ativos: st.warning("Nenhum CC disponível."); return
    opcoes_map = {f"{v['codigo']} — {v['nome']}": k for k, v in sorted(ativos.items(), key=lambda x: x[1]["codigo"])}
    sel_label = st.selectbox("🏢 Centro de Custo", list(opcoes_map.keys()))
    cc_codigo = opcoes_map[sel_label]; cc_info = centros[cc_codigo]
    pfo_bytes = _carregar_arquivo_cc(cc_info, "pfo")
    wbs_custos_bytes = _carregar_arquivo_cc(cc_info, "wbs_custos")
    wbs_mo_bytes = _carregar_arquivo_cc(cc_info, "wbs_mao_de_obra")
    wbs_receitas_bytes = _carregar_arquivo_cc(cc_info, "wbs_receitas")
    if not pfo_bytes: st.info("⬆️ Nenhum PFO enviado. Faça upload na página **📤 Upload**."); return
    wbs_data = {}
    if wbs_receitas_bytes:
        nome_r = cc_info.get("arquivos", {}).get("wbs_receitas", {}).get("nome", "wbs_receitas.xlsx")
        wbs_data["receita"] = _processar_wbs(wbs_receitas_bytes, nome_r)
    if wbs_custos_bytes:
        nome_d = cc_info.get("arquivos", {}).get("wbs_custos", {}).get("nome", "wbs_custos.xlsx")
        wbs_data["despesa"] = _processar_wbs(wbs_custos_bytes, nome_d)
    if wbs_mo_bytes:
        nome_mo = cc_info.get("arquivos", {}).get("wbs_mao_de_obra", {}).get("nome", "wbs_mo.xlsx")
        wbs_data["mo"] = _processar_wbs(wbs_mo_bytes, nome_mo)
    if not wbs_data: st.warning("Nenhuma WBS enviada."); return
    nome_pfo = cc_info.get("arquivos", {}).get("pfo", {}).get("nome", "pfo.xlsx")
    _sec(f"📁 {nome_pfo}")
    tmp = tempfile.mkdtemp(); fp = os.path.join(tmp, nome_pfo)
    with open(fp, "wb") as f: f.write(pfo_bytes)
    try: pfo_tipos = core.ler_pfo_tipo_items(fp)
    finally: shutil.rmtree(tmp, ignore_errors=True)
    if not pfo_tipos: st.warning("Não foi possível extrair tipo-items do PFO."); return
    comparacao = core.comparar_pfo_wbs(pfo_tipos, wbs_receita=wbs_data.get("receita"),
        wbs_despesa=wbs_data.get("despesa"), wbs_mo=wbs_data.get("mo"))
    total_pfo = sum(r["pfo_orcado"] for r in comparacao)
    total_wbs = sum(r["wbs_total"] for r in comparacao)
    total_diff = total_pfo - total_wbs
    n_ok = sum(1 for r in comparacao if r["status"] == "ok")
    n_desvio = sum(1 for r in comparacao if r["status"] == "desvio")
    c1, c2, c3, c4 = st.columns(4)
    _kpi(c1, "PFO Orçado Total", total_pfo / 1000, borda="#0F2847")
    _kpi(c2, "WBS Lumina Total", total_wbs / 1000, borda="#0EA5E9")
    _kpi(c3, "Diferença Total", total_diff / 1000, borda="#DC2626" if abs(total_diff) > 50000 else "#059669")
    c4.markdown(f"<div class='kpi-card' style='border-left-color:#D97706'><div class='kpi-label'>Status</div>"
                f"<div class='kpi-value' style='font-size:1.1rem'>✓ {n_ok} OK | ⚠ {n_desvio} Desvios</div></div>", unsafe_allow_html=True)
    rows_conf = ""
    for r in comparacao:
        status_lbl = "✓ OK" if r["status"] == "ok" else ("⚠ Atenção" if r["status"] == "atencao" else "✗ Desvio")
        cor = "#059669" if r["status"] == "ok" else ("#D97706" if r["status"] == "atencao" else "#DC2626")
        rows_conf += (f"<tr><td>{r['tipo_item']}</td><td>{_fmt(r['pfo_orcado']/1000)}</td><td>{_fmt(r['wbs_total']/1000)}</td>"
                      f"<td style='color:{cor};font-weight:700'>{_fmt(r['diferenca']/1000)}</td>"
                      f"<td style='color:{cor};font-weight:700'>{status_lbl}</td></tr>")
    st.markdown(f"<table class='custom-table'><tr><th>Tipo-Item</th><th>PFO Orçado</th><th>WBS Meta</th>"
                f"<th>Diferença</th><th>Status</th></tr>{rows_conf}</table>", unsafe_allow_html=True)
# =============================================================
#  PG: ESPELHO PFO
# =============================================================
def _pg_espelho(pfos):
    import plotly.graph_objects as go
    st.markdown("## 🪞 Espelho PFO e Análise")
    dados_todos = _dados_ciclo()
    pfos_json = _carregar_pfos_do_json()
    pfos_sessao = st.session_state.get("pfos") or []
    nomes_json = {os.path.basename(p.get("arquivo","")) for p in pfos_json}
    pfos_extras = [p for p in pfos_sessao if os.path.basename(p.get("arquivo","")) not in nomes_json]
    pfos_completo = pfos_json + pfos_extras
    pfos_completo = _filtrar_pfos_usuario(pfos_completo) if pfos_completo else (pfos or [])
    if not pfos_completo: st.info("Nenhum PFO carregado."); return
    pfos = pfos_completo
    dados_esp_sel = _dados_ciclo(); arq_cc_esp_sel = _get_idx_arq_cc(dados_esp_sel)
    centros_esp_sel = dados_esp_sel.get("centros_custo", {})
    def _label_pfo(p):
        nome_arq = os.path.basename(p.get("arquivo", ""))
        cc_cod = arq_cc_esp_sel.get(nome_arq, "")
        cc_nome = centros_esp_sel.get(cc_cod, {}).get("nome", "")
        label = core.nome_curto(p["arquivo"], 40)
        if cc_cod: label = f"{cc_cod} — {cc_nome or label}"
        return label
    nomes = [_label_pfo(p) for p in pfos]
    nomes_vistos = {}; nomes_unicos = []
    for n in nomes:
        if n in nomes_vistos: nomes_vistos[n] += 1; nomes_unicos.append(f"{n} ({nomes_vistos[n]})")
        else: nomes_vistos[n] = 0; nomes_unicos.append(n)
    sel_anterior = st.session_state.get("_esp_sel_nome")
    idx_default = nomes_unicos.index(sel_anterior) if sel_anterior and sel_anterior in nomes_unicos else 0
    sel = st.selectbox("📂 Selecione o projeto", nomes_unicos, index=idx_default, key="esp_sel")
    st.session_state["_esp_sel_nome"] = sel
    p = pfos[nomes_unicos.index(sel)]; ch = _chave(p["arquivo"])
    d = p["dre"]; ct = p.get("contrato", {})
    ctp = ct.get("projetado", d["receita"]["projetado"])
    rp = d["receita"]["projetado"]
    cp = d["custo"]["projetado"] + d.get("cliente", {}).get("projetado", 0.0)
    rsp = d["resultado"]["projetado"]
    if rsp == 0: rsp = rp - cp
    mg = rsp / ctp if ctp else None
    _sec("📊 KPIs do Projeto")
    c1, c2, c3, c4, c5 = st.columns(5)
    _kpi(c1, "Contrato", ctp, borda="#0F2847"); _kpi(c2, "Receita", rp)
    _kpi(c3, "Custos", cp, borda="#DC2626"); _kpi(c4, "Resultado", rsp); _kpi(c5, "Margem", mg, pct=True)
    # Curva S
    _sec("📈 Curva S — Acumulado")
    MP = core.MESES_PT
    dm = {k: {(pt["ano"], pt["mes"]): pt["valor"] for pt in p["dist"].get(k, [])} for k in ["receita", "custo", "resultado"]}
    ativos = [(m["ano"], m["mes"]) for m in p["meses"]
              if abs(dm["receita"].get((m["ano"], m["mes"]), 0.)) > 0.001 or abs(dm["custo"].get((m["ano"], m["mes"]), 0.)) > 0.001]
    if not ativos: ativos = [(m["ano"], m["mes"]) for m in p["meses"]]
    meses_g = [m for m in p["meses"] if (m["ano"], m["mes"]) >= min(ativos) and (m["ano"], m["mes"]) <= max(ativos)]
    acc = {"r": 0., "c": 0.}; lg, ar, ac, as_ = [], [], [], []
    for m in meses_g:
        k = (m["ano"], m["mes"]); acc["r"] += dm["receita"].get(k, 0.); acc["c"] += dm["custo"].get(k, 0.)
        lg.append(m["label"]); ar.append(round(acc["r"], 1)); ac.append(round(acc["c"], 1)); as_.append(round(acc["r"] - acc["c"], 1))
    fig = go.Figure()
    for y, nm, cor in [(ar, "Receita", "#0EA5E9"), (ac, "Custo", "#DC2626"), (as_, "Resultado", "#059669")]:
        fig.add_trace(go.Scatter(x=lg, y=y, name=nm, line=dict(color=cor, width=2.5), mode="lines+markers", marker=dict(size=4)))
    _esp_layout = ui.plotly_theme(); _esp_layout["height"] = 320
    fig.update_layout(title=dict(text="Curva S (R$ mil)", font=dict(size=13)), **_esp_layout)
    st.plotly_chart(fig, use_container_width=True)
    # Tabela mensal
    _sec("📅 Resultado Mensal")
    if meses_g:
        rows_m = ""
        for m in meses_g:
            k = (m["ano"], m["mes"]); vr = dm["receita"].get(k, 0.); vc = dm["custo"].get(k, 0.); vs = vr - vc
            tp = "🔵 Real" if core.is_real(m["ano"], m["mes"]) else "⚪ Plan."
            rows_m += f"<tr><td>{m['label']}</td><td style='font-size:.78rem;color:#94A3B8'>{tp}</td><td>{_fmt(vr)}</td><td>{_fmt(vc)}</td><td class='kpi-value {_cls(vs)}' style='font-size:.82rem'>{_fmt(vs)}</td></tr>"
        st.markdown(f"<table class='custom-table'><tr><th>Mês</th><th>Tipo</th><th>Receita</th><th>Custo</th><th>Resultado</th></tr>{rows_m}</table>", unsafe_allow_html=True)
    # Fluxo de Aprovação
    alcada_esp = st.session_state.get("alcada", "viewer")
    usuario_logado = st.session_state.get("usuario", "")
    nome_logado = st.session_state.get("nome", "")
    st.divider()
    st.markdown("## 📋 Fluxo de Validação e Aprovação")
    if alcada_esp not in ("admin", "validador", "diretor"):
        st.info("ℹ️ Disponível para Validadores, Diretores e Administradores."); return
    aprv_esp = _carregar_aprovacoes(); comentarios_esp = _carregar_comentarios()
    dados_esp = _dados_ciclo(); centros_esp = dados_esp.get("centros_custo", {})
    arq_cc_esp = _get_idx_arq_cc(dados_esp)
    cc_codigo_esp = arq_cc_esp.get(os.path.basename(p.get("arquivo", "")), "")
    ch_esp = _chave(p["arquivo"])
    reg_esp = aprv_esp.get(ch_esp, {"status": "pendente", "aprovacoes_diretoria": {}})
    status_esp = reg_esp.get("status", "pendente")
    upload_info = reg_esp.get("upload"); valid_info = reg_esp.get("validacao"); rep_info = reg_esp.get("reprovacao")
    aprovs = reg_esp.get("aprovacoes_diretoria", {}); n_aprovs = len(aprovs); n_needed = PARAMS["n_diretores"]
    # Timeline
    if status_esp == "aprovado": etapa_atual = "concluido"
    elif status_esp == "reprovado": etapa_atual = "reprovado"
    elif valid_info and n_aprovs < n_needed: etapa_atual = "aprovacao"
    elif upload_info and not valid_info: etapa_atual = "validacao"
    elif not upload_info: etapa_atual = "upload"
    else: etapa_atual = "concluido"
    todos_users_esp = _get_usuarios()
    diretores_esp = {k: v for k, v in todos_users_esp.items() if k in APROVADORES_PFO}
    aprovacoes_esp = reg_esp.get("aprovacoes_diretoria", {})
    if etapa_atual == "validacao": proxima_acao = "🔍 Aguardando validação"; cor_banner = "#DBEAFE"; cor_text = "#1E3A8A"
    elif etapa_atual == "aprovacao":
        faltam = n_needed - n_aprovs; proxima_acao = f"✅ Aguardando {faltam} diretor(es)"; cor_banner = "#EDE9FE"; cor_text = "#4C1D95"
    elif etapa_atual == "concluido": proxima_acao = "🎉 PFO aprovado"; cor_banner = "#DCFCE7"; cor_text = "#14532D"
    else: proxima_acao = "❌ PFO reprovado"; cor_banner = "#FEE2E2"; cor_text = "#7F1D1D"
    st.markdown(f"<div style='background:{cor_banner};border-radius:12px;padding:1rem 1.4rem;margin-bottom:1rem;color:{cor_text};font-size:.92rem'>{proxima_acao}</div>", unsafe_allow_html=True)
    # Comentários
    _sec("💬 Comentários")
    coms_esp = comentarios_esp.get(ch_esp, [])
    for cm in coms_esp:
        st.markdown(f"<div class='comment-box'><strong>{cm['nome']}</strong> <span style='color:#94A3B8'>— {cm['data_hora']}</span><br>{cm['texto']}</div>", unsafe_allow_html=True)
    novo_com_esp = st.text_input("Adicionar comentário", key=f"com_esp_{ch_esp}", placeholder="Escreva um comentário...")
    if novo_com_esp and st.button("💬 Enviar", key=f"btn_com_esp_{ch_esp}"):
        _registrar_comentario(ch_esp, novo_com_esp); st.success("Comentário registrado!"); time.sleep(0.5); st.rerun()
    # Botões de ação
    st.divider()
    cv_esp, ca_esp, cr_esp = st.columns(3)
    with cv_esp:
        _pode_validar_esp = (alcada_esp in ("admin", "validador") and reg_esp.get("upload") and not reg_esp.get("validacao") and status_esp not in ("reprovado", "aprovado"))
        if _pode_validar_esp:
            if st.button("🔍 Validar", key=f"v_esp_{ch_esp}", use_container_width=True, type="primary"):
                _registrar(ch_esp, "validacao", cc_codigo=cc_codigo_esp); st.success("Validado!"); st.session_state["_esp_sel_nome"] = sel; time.sleep(0.5); st.rerun()
    with ca_esp:
        _pode_aprovar_esp = (usuario_logado in APROVADORES_PFO and reg_esp.get("validacao") and status_esp not in ("reprovado", "aprovado"))
        if _pode_aprovar_esp:
            ja_aprovou_esp = usuario_logado in reg_esp.get("aprovacoes_diretoria", {})
            if ja_aprovou_esp: st.success("✓ Já aprovou")
            else:
                if st.button("✅ Aprovar", key=f"a_esp_{ch_esp}", use_container_width=True, type="primary"):
                    _registrar(ch_esp, "aprovacao_diretor", cc_codigo=cc_codigo_esp); st.success("Aprovação registrada!"); st.session_state["_esp_sel_nome"] = sel; time.sleep(0.5); st.rerun()
    with cr_esp:
        if (alcada_esp in ("admin", "validador", "diretor") and reg_esp.get("upload") and status_esp not in ("aprovado", "reprovado")):
            motivo_esp = st.text_input("Motivo", key=f"mot_esp_{ch_esp}", label_visibility="collapsed", placeholder="Motivo da reprovação")
            if st.button("❌ Reprovar", key=f"r_esp_{ch_esp}", use_container_width=True):
                _registrar(ch_esp, "reprovacao", motivo_esp, cc_codigo=cc_codigo_esp); st.error("Reprovado!"); st.session_state["_esp_sel_nome"] = sel; time.sleep(0.5); st.rerun()
# =============================================================
#  PG: EXPORTAR
# =============================================================
def _pg_exportar(pfos):
    st.markdown("## ⬇️ Exportar Relatórios")
    def _gerar_excel(pfs):
        tmp = tempfile.mkdtemp(); p2 = os.path.join(tmp, "Consolidado.xlsx"); core.gerar_excel(pfs, p2)
        with open(p2, "rb") as f: d = f.read()
        shutil.rmtree(tmp, ignore_errors=True); return d
    def _gerar_pdf(pfs):
        tmp = tempfile.mkdtemp(); p2 = os.path.join(tmp, "Relatorio.pdf"); core.gerar_pdf(pfs, p2)
        with open(p2, "rb") as f: d = f.read()
        shutil.rmtree(tmp, ignore_errors=True); return d
    c1, c2 = st.columns(2)
    with c1:
        st.markdown("### 📊 Excel Consolidado")
        if st.button("Gerar Excel", use_container_width=True, type="primary"):
            with st.spinner("Gerando..."): data = _gerar_excel(pfos)
            st.download_button("⬇️ Baixar Excel", data, file_name=f"Consolidado_PFO_{core.HOJE.strftime('%Y%m%d_%H%M')}.xlsx",
                               mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", use_container_width=True)
    with c2:
        st.markdown("### 📄 PDF Executivo")
        if st.button("Gerar PDF", use_container_width=True, type="primary"):
            with st.spinner("Gerando..."): data = _gerar_pdf(pfos)
            st.download_button("⬇️ Baixar PDF", data, file_name=f"Relatorio_PFO_{core.HOJE.strftime('%Y%m%d_%H%M')}.pdf",
                               mime="application/pdf", use_container_width=True)
# =============================================================
#  ★ OTIMIZADO v4.1: Migração INCREMENTAL
# =============================================================
def _migrar_pfos_para_json():
    """Migra PFOs do Drive para JSON — salva CADA UM imediatamente."""
    _import_core()
    dados = _carregar_json()
    centros = dados.get("centros_custo", {})
    pfos_dados = dados.get("pfos_dados", {})
    # Só migrar os que FALTAM
    ccs_com_pfo = [(cod, cc) for cod, cc in centros.items()
                   if cc.get("status") == "ativo" and cc.get("requer_pfo", True)
                   and cc.get("arquivos", {}).get("pfo", {}).get("gdrive_id")
                   and cod not in pfos_dados]
    total = len(ccs_com_pfo)
    if total == 0:
        return 0, 0, ["Todos os PFOs já estão no JSON! Nada a migrar."]
    ok = 0; erros = []
    progress = st.progress(0, text="Iniciando migração...")
    for i, (cod, cc) in enumerate(ccs_com_pfo):
        nome_pfo = cc.get("arquivos", {}).get("pfo", {}).get("nome", f"pfo_{cod}.xlsx")
        progress.progress((i) / total, text=f"Processando {i+1}/{total}: {nome_pfo}")
        try:
            gdrive_id = cc["arquivos"]["pfo"]["gdrive_id"]
            pfo_bytes = _carregar_arquivo_gdrive(gdrive_id)
            if not pfo_bytes: erros.append(f"❌ {nome_pfo}: não encontrado"); continue
            tmp = tempfile.mkdtemp(); fp = os.path.join(tmp, nome_pfo)
            with open(fp, "wb") as f: f.write(pfo_bytes)
            try: pfo_data = core.ler_pfo(fp)
            finally: shutil.rmtree(tmp, ignore_errors=True)
            pfo_serial = _serializar_pfo(pfo_data)
            # SAVE IMEDIATO
            dados_save = _carregar_json()
            if "pfos_dados" not in dados_save: dados_save["pfos_dados"] = {}
            dados_save["pfos_dados"][cod] = pfo_serial
            if _pfo_dados_tamanho_ok(dados_save):
                json_ok, json_err = _salvar_json(dados_save)
                if json_ok: ok += 1
                else: erros.append(f"⚠️ {nome_pfo}: falha ao salvar: {json_err}")
            else: erros.append(f"⚠️ {nome_pfo}: JSON muito grande"); break
        except Exception as e: erros.append(f"❌ {nome_pfo}: {e}")
    progress.progress(1.0, text=f"Concluído: {ok}/{total} migrados")
    if ok > 0: _invalidar_cache_ciclo()
    return ok, total, erros
# =============================================================
#  PG: ADMIN
# =============================================================
def _pg_admin():
    st.markdown("## ⚙️ Administração")
    tab1, tab2, tab3, tab4, tab5 = st.tabs(["👥 Usuários", "📋 Histórico", "🔧 Parâmetros", "⚙️ Config", "🔄 Migração"])
    with tab1:
        usuarios = _get_usuarios()
        _sec("Usuários Cadastrados")
        rows_u = ""
        for login, dados_u in usuarios.items():
            ccs_usr = dados_u.get("centros_custo", ["*"])
            ccs_label = "Todos" if "*" in ccs_usr else ", ".join(ccs_usr)
            rows_u += f"<tr><td>{login}</td><td>{dados_u['nome']}</td><td>{ALCADA_LABEL.get(dados_u['alcada'], dados_u['alcada'])}</td><td>{ccs_label}</td></tr>"
        st.markdown(f"<table class='custom-table'><tr><th>Login</th><th>Nome</th><th>Perfil</th><th>CCs</th></tr>{rows_u}</table>", unsafe_allow_html=True)
        _sec("➕ Novo Usuário")
        with st.form("form_novo_usuario"):
            co1, co2 = st.columns(2)
            novo_login = co1.text_input("Login", placeholder="joao.silva")
            novo_nome = co2.text_input("Nome completo")
            co3, co4 = st.columns(2)
            nova_senha = co3.text_input("Senha", type="password")
            nova_alcada = co4.selectbox("Perfil", options=list(ALCADA_DESC.keys()), format_func=lambda x: ALCADA_DESC[x])
            salvar = st.form_submit_button("💾 Cadastrar", use_container_width=True, type="primary")
        if salvar:
            if not novo_login or not novo_nome or not nova_senha: st.error("Preencha todos os campos.")
            elif len(nova_senha) < 4: st.error("Senha: mínimo 4 caracteres.")
            else:
                login_norm = novo_login.lower().strip()
                if login_norm in usuarios: st.error(f"Login '{login_norm}' já existe.")
                else:
                    usuarios[login_norm] = {"senha": nova_senha, "nome": novo_nome, "alcada": nova_alcada, "centros_custo": ["*"]}
                    _save_usuarios(usuarios); st.success(f"✅ Usuário '{novo_login}' cadastrado!"); time.sleep(0.4); st.rerun()
    with tab2:
        _sec("Histórico de Aprovações")
        aprv = _carregar_aprovacoes()
        if not aprv: st.info("Nenhum registro.")
        else:
            for ch, reg in aprv.items():
                status = reg.get("status", "pendente")
                with st.expander(f"{ch} — {_badge(status)}", expanded=False):
                    for et_k, et_l in [("upload", "📁 Upload"), ("validacao", "🔍 Validação"), ("reprovacao", "❌ Reprovação")]:
                        info = reg.get(et_k)
                        if info: st.markdown(f"**{et_l}:** {info['nome']} — {info['data_hora']}" + (f" | Motivo: _{info['motivo']}_" if info.get("motivo") else ""))
                    dirs = reg.get("aprovacoes_diretoria", {})
                    if dirs:
                        st.markdown("**✅ Aprovações:**")
                        for login, d in dirs.items(): st.markdown(f"  - {d['nome']} — {d['data_hora']}")
    with tab3:
        _sec("Parâmetros do Sistema")
        cols = st.columns(2)
        with cols[0]: st.metric("Meta Backoffice", f"{PARAMS['meta_backoffice']*100:.1f}%"); st.metric("Diretores", PARAMS["n_diretores"])
        with cols[1]: st.metric("DU Upload", f"{PARAMS['du_upload']}º"); st.metric("DU Validação", f"{PARAMS['du_validacao']}º")
    with tab5:
        st.markdown("## 🔄 Migração de PFOs para JSON")
        st.info("Processa PFOs do Drive e salva no JSON — **um por um, com save imediato**. "
                "Após migração, dashboard carrega instantaneamente.")
        dados_adm = _dados_ciclo()
        pfos_dados_adm = dados_adm.get("pfos_dados", {})
        centros_adm = dados_adm.get("centros_custo", {})
        total_ccs = sum(1 for cc in centros_adm.values()
                        if cc.get("status") == "ativo" and cc.get("requer_pfo", True)
                        and cc.get("arquivos", {}).get("pfo", {}).get("gdrive_id"))
        ja_migrados = len(pfos_dados_adm)
        col_m1, col_m2, col_m3 = st.columns(3)
        col_m1.metric("CCs com PFO", total_ccs); col_m2.metric("No JSON", ja_migrados)
        col_m3.metric("Faltando", max(0, total_ccs - ja_migrados))
        if ja_migrados >= total_ccs and total_ccs > 0:
            st.success("✅ Todos os PFOs já estão no JSON! Dashboard otimizado.")
        if st.button("🔄 Migrar PFOs Faltantes", type="primary", use_container_width=True, disabled=(total_ccs == 0)):
            with st.status("🔄 Migrando...", expanded=True) as status_mig:
                ok, total_m, erros_mig = _migrar_pfos_para_json()
                for err in erros_mig: st.write(err)
                if ok == total_m: status_mig.update(label=f"✅ {ok}/{total_m} migrados!", state="complete")
                else: status_mig.update(label=f"⚠️ {ok}/{total_m} migrados", state="error")
            if ok > 0: time.sleep(0.8); st.rerun()
    with tab4:
        token, repo, path = _gh()
        if token: st.success("✅ Token GitHub configurado.")
        else: st.warning("⚠️ Sem token — dados na sessão apenas.")
        svc = _gdrive_service()
        if svc: st.success("✅ Google Drive conectado.")
        else: st.warning("⚠️ Google Drive não configurado.")
# =============================================================
#  PG: HOME
# =============================================================
def _pg_home():
    MP = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
    now = _agora(); mes_label = f"{MP[now.month-1]}/{now.year}"; mes_ref = _mes_ref_atual()
    dados = _dados_ciclo()
    centros = dados.get("centros_custo", {})
    ativos = {k: v for k, v in centros.items() if v.get("status") == "ativo" and v.get("requer_pfo", True)}
    ativos = _filtrar_centros_usuario(ativos)
    aprv = dados.get("aprovacoes", {}); comentarios = dados.get("comentarios", {})
    alcada = st.session_state.get("alcada", "viewer"); nome_usuario = st.session_state.get("nome", "")
    saudacao = "Bom dia" if now.hour < 12 else ("Boa tarde" if now.hour < 18 else "Boa noite")
    n_requer = len(ativos)
    n_enviado  = sum(1 for v in ativos.values() if _status_pfo_cc(v, mes_ref) in ("enviado","validado","aprovado"))
    n_validado = sum(1 for v in ativos.values() if _status_pfo_cc(v, mes_ref) in ("validado","aprovado"))
    n_aprovado = sum(1 for v in ativos.values() if _status_pfo_cc(v, mes_ref) == "aprovado")
    n_pendente = n_requer - n_enviado
    n_reprovado = sum(1 for v in ativos.values() if _status_pfo_cc(v, mes_ref) == "reprovado")
    pct_envio = int(n_enviado / n_requer * 100) if n_requer else 0
    pct_aprov = int(n_aprovado / n_requer * 100) if n_requer else 0
    st.markdown("""<style>
    .status-pill { display:inline-flex;align-items:center;gap:.3rem;padding:.2rem .7rem;border-radius:20px;font-size:.72rem;font-weight:700; }
    .pill-enviado  { background:#EFF6FF;color:#1D4ED8; }
    .pill-validado { background:#F5F3FF;color:#6D28D9; }
    .pill-aprovado { background:#DCFCE7;color:#15803D; }
    .pill-reprovado{ background:#FEE2E2;color:#B91C1C; }
    .pill-pendente { background:#FEF9C3;color:#92400E; }
    </style>""", unsafe_allow_html=True)
    cor_kpi_pend = "rgba(252,165,165,.25)" if n_pendente > 0 else "rgba(255,255,255,.1)"
    cor_val_pend = "#FCA5A5" if n_pendente > 0 else "#FFFFFF"
    st.markdown(f"""<div style='background:linear-gradient(135deg,#0B2D54 0%,#1A4F8A 60%,#1E6FC4 100%);
        border-radius:16px;padding:2rem 2.4rem 1.6rem;margin-bottom:1.5rem;color:#fff;box-shadow:0 4px 20px rgba(11,45,84,.4)'>
        <div style='display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:1rem'>
            <div>
                <h1 style='margin:0 0 .2rem;font-size:1.9rem;font-weight:800;color:#fff'>{saudacao}, {nome_usuario.split()[0] if nome_usuario else 'Gestor'}</h1>
                <div style='font-size:.82rem;opacity:.75'>Plataforma PFO — Global Service Engenharia</div>
                <div style='font-size:.9rem;font-weight:600;color:rgba(255,255,255,.9);margin-top:.4rem'>Ciclo mensal: <span style='color:#7DD3FC'>{mes_label}</span></div>
            </div>
            <div style='text-align:right;min-width:200px'>
                <div style='font-size:.62rem;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.08em;font-weight:600;margin-bottom:.5rem'>Progresso</div>
                <div style='height:6px;background:rgba(255,255,255,.15);border-radius:6px;overflow:hidden;margin-bottom:.6rem'>
                    <div style='height:100%;border-radius:6px;background:linear-gradient(90deg,#38BDF8,#06B6D4);width:{pct_envio}%'></div></div>
                <div style='font-size:.7rem;color:rgba(255,255,255,.7)'>Envio: {pct_envio}% | Aprovação: {pct_aprov}%</div>
            </div>
        </div>
        <div style='display:grid;grid-template-columns:repeat(5,1fr);gap:.8rem;margin-top:1.4rem'>
            <div style='background:rgba(255,255,255,.1);border-radius:12px;padding:.8rem 1rem;border:1px solid rgba(255,255,255,.15);text-align:center'>
                <div style='font-size:1.7rem;font-weight:800;color:#fff'>{n_requer}</div><div style='font-size:.62rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.65);font-weight:600;margin-top:.2rem'>CCs Ativos</div></div>
            <div style='background:rgba(255,255,255,.1);border-radius:12px;padding:.8rem 1rem;border:1px solid rgba(255,255,255,.15);text-align:center'>
                <div style='font-size:1.7rem;font-weight:800;color:#fff'>{n_enviado}<span style='font-size:1rem;opacity:.7'>/{n_requer}</span></div><div style='font-size:.62rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.65);font-weight:600;margin-top:.2rem'>Enviado</div></div>
            <div style='background:rgba(255,255,255,.1);border-radius:12px;padding:.8rem 1rem;border:1px solid rgba(255,255,255,.15);text-align:center'>
                <div style='font-size:1.7rem;font-weight:800;color:#fff'>{n_validado}</div><div style='font-size:.62rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.65);font-weight:600;margin-top:.2rem'>Validados</div></div>
            <div style='background:rgba(255,255,255,.1);border-radius:12px;padding:.8rem 1rem;border:1px solid rgba(255,255,255,.15);text-align:center'>
                <div style='font-size:1.7rem;font-weight:800;color:#fff'>{n_aprovado}</div><div style='font-size:.62rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.65);font-weight:600;margin-top:.2rem'>Aprovados</div></div>
            <div style='background:{cor_kpi_pend};border-radius:12px;padding:.8rem 1rem;border:1px solid rgba(255,255,255,.15);text-align:center'>
                <div style='font-size:1.7rem;font-weight:800;color:{cor_val_pend}'>{n_pendente}</div><div style='font-size:.62rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.65);font-weight:600;margin-top:.2rem'>Pendentes</div></div>
        </div>
    </div>""", unsafe_allow_html=True)
    # Alertas
    total_pend = n_pendente + n_reprovado
    if total_pend > 0:
        st.markdown(f"<div style='background:#FEF3C7;border-left:4px solid #D97706;border-radius:12px;padding:.9rem 1.4rem;margin-bottom:1.4rem;color:#78350F;font-size:.88rem;font-weight:600'>⚠️ {total_pend} ações pendentes no ciclo {mes_label}</div>", unsafe_allow_html=True)
    else:
        st.markdown(f"<div style='background:#DCFCE7;border-left:4px solid #059669;border-radius:12px;padding:.9rem 1.4rem;margin-bottom:1.4rem;color:#14532D;font-size:.88rem;font-weight:600'>✅ Todos os PFOs do ciclo {mes_label} estão em dia.</div>", unsafe_allow_html=True)
    # Tabela status
    if ativos:
        def _pill(status):
            m = {"enviado":("pill-enviado","📤 Enviado"),"validado":("pill-validado","🔍 Validado"),"aprovado":("pill-aprovado","✅ Aprovado"),
                 "reprovado":("pill-reprovado","❌ Reprovado"),"pendente":("pill-pendente","⏳ Pendente")}
            cls, lbl = m.get(status, ("pill-pendente","⏳ Pendente"))
            return f"<span class='status-pill {cls}'>{lbl}</span>"
        rows = ""
        for cc in sorted(ativos.values(), key=lambda x: x.get("codigo","")):
            st_pfo = _status_pfo_cc(cc, mes_ref)
            pfo_info = cc.get("pfo_mensal", {}).get(mes_ref, {})
            rows += (f"<tr><td style='font-family:monospace;font-size:.78rem;color:#2563EB;font-weight:600'>{cc.get('codigo','')}</td>"
                     f"<td style='font-weight:500'>{cc.get('nome','')}</td>"
                     f"<td style='text-align:center'>{_pill(st_pfo)}</td>"
                     f"<td style='font-size:.78rem;color:#475569'>{pfo_info.get('enviado_em','—')}</td>"
                     f"<td style='font-size:.78rem;color:#475569'>{pfo_info.get('enviado_por_nome', pfo_info.get('enviado_por','—'))}</td></tr>")
        st.markdown(f"""<div style='background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0;box-shadow:0 1px 4px rgba(0,0,0,.05)'>
            <table style='width:100%;border-collapse:collapse;font-size:.84rem'>
            <thead><tr style='background:#1E3A5F'>
            <th style='color:#fff;padding:.6rem 1rem;text-align:left;font-size:.68rem;text-transform:uppercase;letter-spacing:.07em;font-weight:700'>Código</th>
            <th style='color:#fff;padding:.6rem 1rem;text-align:left;font-size:.68rem;text-transform:uppercase'>Centro de Custo</th>
            <th style='color:#fff;padding:.6rem 1rem;text-align:center;font-size:.68rem;text-transform:uppercase'>Status</th>
            <th style='color:#fff;padding:.6rem 1rem;text-align:left;font-size:.68rem;text-transform:uppercase'>Enviado em</th>
            <th style='color:#fff;padding:.6rem 1rem;text-align:left;font-size:.68rem;text-transform:uppercase'>Enviado por</th>
            </tr></thead><tbody>{rows}</tbody></table></div>""", unsafe_allow_html=True)
# =============================================================
#  MAIN
# =============================================================
def main():
    _check_login()
    _css()
    if "_dados_carregados" not in st.session_state:
        dados = _dados_ciclo()
        if "pfos" in dados and dados["pfos"] and not st.session_state.get("pfos"):
            st.session_state["pfos"] = dados["pfos"]
        st.session_state["_dados_carregados"] = True
        time.sleep(0.5)
    _import_core()
    alcada = st.session_state.get("alcada", "viewer")
    with st.sidebar:
        nome_sb = st.session_state.get('nome', '')
        alcada_sb_label = ALCADA_LABEL.get(alcada, alcada)
        st.markdown(f"""<div style='padding:.8rem 0 .4rem;text-align:center'>
            <div style='font-size:.9rem;font-weight:700;color:#E2E8F0'>{nome_sb}</div>
            <div style='font-size:.72rem;color:#94A3B8;margin-top:.1rem'>{'🔑' if alcada == 'admin' else '👤'} {alcada_sb_label}</div>
        </div>""", unsafe_allow_html=True)
        st.divider()
        nav_items = [
            ("🏠", "Home", "Visão geral do ciclo"),
            ("🏢", "Centros de Custo", "Gestão e cadastro"),
            ("📤", "Faça o upload do PFO aqui", "Enviar arquivos PFO"),
            ("📊", "Dashboard", "Análise consolidada"),
            ("🔍", "PFO vs WBS", "Conferência de dados"),
            ("🪞", "Espelho PFO e Análise", "Detalhe + aprovação"),
            ("⬇️", "Baixe os Relatórios", "Excel, PDF e PPTX"),
        ]
        if alcada == "admin":
            nav_items.append(("⚙️", "Admin", "Usuários e configurações"))
        paginas = [item[1] for item in nav_items]
        if "_nav_pagina" not in st.session_state:
            st.session_state["_nav_pagina"] = paginas[0]
        for icone, nome, desc in nav_items:
            is_active = (st.session_state.get("_nav_pagina") == nome)
            if is_active:
                st.markdown(f"<style>section[data-testid='stSidebar'] [data-testid='stButton-nav_{nome}'] > button {{"
                    "background:linear-gradient(135deg,#1E3A5F,#1A6FC4) !important;border:1px solid #2563EB !important;"
                    "color:#FFFFFF !important;font-weight:700 !important;box-shadow:0 3px 10px rgba(37,99,235,.4) !important;}}</style>", unsafe_allow_html=True)
            if st.button(f"{icone}  {nome}\n{desc}", key=f"nav_{nome}", use_container_width=True):
                st.session_state["_nav_pagina"] = nome; time.sleep(0.2); st.rerun()
        pagina = st.session_state.get("_nav_pagina", paginas[0])
        st.divider()
        pfos_sidebar = st.session_state.get("_pfos_reprocessados") or st.session_state.get("pfos")
        if pfos_sidebar:
            n_op = sum(1 for p in pfos_sidebar if not core.is_gse(p["arquivo"]))
            st.markdown(f"<div style='font-size:.72rem;color:#94A3B8;text-align:center'>✓ {len(pfos_sidebar)} PFOs ({n_op} oper.)</div>", unsafe_allow_html=True)
        # Status rápido
        mes_ref = _mes_ref_atual()
        dados_sb = _dados_ciclo()
        centros_sb = dados_sb.get("centros_custo", {})
        ativos_sb = {k: v for k, v in centros_sb.items() if v.get("status") == "ativo" and v.get("requer_pfo", True)}
        ativos_sb = _filtrar_centros_usuario(ativos_sb)
        n_aprov_sb = sum(1 for v in ativos_sb.values() if _status_pfo_cc(v, mes_ref) == "aprovado")
        n_total_sb = len(ativos_sb)
        if n_total_sb > 0:
            pct = int(n_aprov_sb / n_total_sb * 100)
            cor_barra = "#059669" if pct == 100 else ("#D97706" if pct >= 50 else "#DC2626")
            st.markdown(f"<div style='text-align:center;padding:.2rem 0'>"
                f"<div style='font-size:.62rem;color:#64748B;text-transform:uppercase;letter-spacing:.08em;font-weight:600'>Progresso {_mes_ref_label()}</div>"
                f"<div style='background:rgba(255,255,255,.06);border-radius:6px;height:6px;margin:.3rem .5rem;overflow:hidden'>"
                f"<div style='height:100%;width:{pct}%;background:{cor_barra};border-radius:6px'></div></div>"
                f"<div style='font-size:.65rem;color:#94A3B8'>{n_aprov_sb}/{n_total_sb} aprovados</div></div>", unsafe_allow_html=True)
        st.divider()
        # Atualizar dados
        with st.expander("🔄 Atualizar dados", expanded=False):
            if st.button("📥 Recarregar PFOs", use_container_width=True):
                for k in list(st.session_state.keys()):
                    if k.startswith(("_dados_ciclo", "_pfos_", "_gdrive_file_", "_json_fetch_ts", "_dados_local", "_usuarios", "_idx_")):
                        st.session_state.pop(k, None)
                st.session_state["_dados_ciclo_ts"] = 0; st.session_state["_json_fetch_ts"] = 0
                time.sleep(0.4); st.rerun()
        # Alterar Senha
        with st.expander("🔑 Alterar Senha", expanded=False):
            with st.form("sidebar_change_pwd"):
                pwd_at = st.text_input("Senha atual", type="password", key="sb_pwd_at")
                pwd_nv = st.text_input("Nova senha", type="password", key="sb_pwd_nv")
                pwd_cf = st.text_input("Confirmar", type="password", key="sb_pwd_cf")
                ok_ch = st.form_submit_button("Salvar", use_container_width=True)
            if ok_ch:
                usuarios = _get_usuarios(); login_atual = st.session_state.get("usuario"); u = usuarios.get(login_atual)
                if not u or u["senha"] != pwd_at: st.error("Senha atual incorreta.")
                elif not pwd_nv or len(pwd_nv) < 4: st.error("Mínimo 4 caracteres.")
                elif pwd_nv != pwd_cf: st.error("Senhas não coincidem.")
                else: u["senha"] = pwd_nv; _save_usuarios(usuarios); st.success("✅ Senha alterada!")
        if st.button("🚪 Sair", use_container_width=True):
            for k in ["logado", "usuario", "nome", "alcada", "pfos", "_arqs_bytes", "_wbs_data",
                       "_usuarios", "_gh_sha", "_dados_local", "_gdrive_svc", "_dados_carregados",
                       "_pfos_reprocessados", "_nav_target", "_dados_ciclo", "_pfos_hash"]:
                st.session_state.pop(k, None)
            for k in list(st.session_state.keys()):
                if k.startswith(("_idx_", "_gdrive_file_", "_gh_file_", "_wbs_cache_", "_dash_", "_portal_dl_")):
                    st.session_state.pop(k, None)
            time.sleep(0.4); st.rerun()
    # Páginas sem PFO
    _paginas_sem_pfo = {"Home", "Centros de Custo", "Faça o upload do PFO aqui", "Admin"}
    _precisa_pfo = pagina not in _paginas_sem_pfo
    if _precisa_pfo:
        pfos_raw = _obter_pfos_dashboard()
        pfos = _filtrar_pfos_usuario(pfos_raw) if pfos_raw else pfos_raw
    else:
        pfos_raw = st.session_state.get("_pfos_reprocessados") or st.session_state.get("pfos")
        pfos = _filtrar_pfos_usuario(pfos_raw) if pfos_raw else pfos_raw
    if pagina == "Home": _pg_home()
    elif "Centros de Custo" in pagina: _pg_centros_custo()
    elif pagina == "Faça o upload do PFO aqui": _pg_upload()
    elif "Dashboard" in pagina:
        if not pfos: st.warning("⚠️ Faça upload dos PFOs primeiro.")
        else: _pg_dashboard(pfos)
    elif "PFO vs WBS" in pagina:
        if not pfos: st.warning("⚠️ Faça upload dos PFOs primeiro.")
        else: _pg_conferencia(pfos)
    elif "Espelho PFO e Análise" in pagina:
        _alcada_esp = st.session_state.get("alcada", "viewer")
        _pfos_espelho = pfos_raw if _alcada_esp in ("admin", "diretor", "validador") else pfos
        if not _pfos_espelho: st.warning("⚠️ Faça upload dos PFOs primeiro.")
        else: _pg_espelho(_pfos_espelho)
    elif "Baixe os Relatórios" in pagina:
        if not pfos: st.warning("⚠️ Faça upload dos PFOs primeiro.")
        else: _pg_exportar(pfos)
    elif "Admin" in pagina: _pg_admin()
if __name__ == "__main__":
    main()
