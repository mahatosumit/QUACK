/** Typed contract used by the embedded, dependency-free QUACK Control Room client. */
export type StudioRoute =
  | "home" | "overview" | "console" | "missions" | "new-mission" | "mission" | "workspace"
  | "agents" | "models" | "actions" | "integrations" | "browser" | "files" | "approvals"
  | "traces" | "trace" | "artifacts" | "evidence" | "audit" | "extensions" | "ecosystem"
  | "system" | "settings" | "recovery";

export interface StudioApiClientContract {
  readonly dashboardState: "/dashboard/state";
  readonly missions: "/missions";
  readonly proposals: "/improvement/proposals";
  readonly providers: "/providers";
  readonly actions: "/actions";
  readonly mcp: "/mcp";
  readonly agents: "/agents";
  readonly memory: "/memory";
  readonly extensions: "/extensions";
  readonly governedMissions: "/governed-missions";
  readonly settings: "/settings";
  readonly systemStatus: "/system/status";
  readonly approvals: "/approvals";
  readonly events: "/events";
  readonly workspaceTree: "/workspace/tree";
  readonly workspaceFile: "/workspace/file";
  readonly workspaceGit: "/workspace/git";
}

export const STUDIO_API: StudioApiClientContract = {
  dashboardState: "/dashboard/state",
  missions: "/missions",
  proposals: "/improvement/proposals",
  providers: "/providers",
  actions: "/actions",
  mcp: "/mcp",
  agents: "/agents",
  memory: "/memory",
  extensions: "/extensions",
  governedMissions: "/governed-missions",
  settings: "/settings",
  systemStatus: "/system/status",
  approvals: "/approvals",
  events: "/events",
  workspaceTree: "/workspace/tree",
  workspaceFile: "/workspace/file",
  workspaceGit: "/workspace/git",
};

export function studioHtml(): string {
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>QUACK — AI-Native Execution Environment</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🦆</text></svg>">
  <link rel="stylesheet" href="/dashboard/styles.css">
</head>
<body>
  <a class="skip-link" href="#studio-page">Skip to content</a>
  <div class="studio-shell">
    <aside class="sidebar" aria-label="Primary navigation">
      <a class="brand" href="#home" aria-label="QUACK home">
        <div class="brand-duck-icon" aria-hidden="true">
          <svg width="34" height="34" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M28.5 16C28.5 13.5147 26.4853 11.5 24 11.5C23.6338 11.5 23.2796 11.5438 22.9404 11.6264C21.8211 8.84152 19.1416 7 16 7C11.5817 7 8 10.5817 8 15C8 15.3421 8.02151 15.6791 8.06316 16.0102C5.74836 17.0658 4 19.3879 4 22.1C4 25.966 7.13401 29.1 11 29.1H24C27.866 29.1 31 25.966 31 22.1C31 19.7891 29.8979 17.7289 28.5 16Z" fill="#F59E0B"/>
            <circle cx="14" cy="13" r="2" fill="#1E293B"/>
            <path d="M22 17C23.5 17 26 18 27 20C25 21 22 20 22 17Z" fill="#D97706"/>
          </svg>
        </div>
        <div class="brand-text">
          <strong class="brand-title">QUACK</strong>
          <small class="brand-sub">From intent to verified outcomes</small>
        </div>
      </a>
      <nav class="nav" id="studio-nav">
        <div class="primary-nav-group">
          <a href="#home" data-route="home" class="nav-item active">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
            <span>Home</span>
          </a>
          <a href="#missions" data-route="missions" class="nav-item">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>
            <span>Missions</span>
          </a>
          <a href="#workspace" data-route="workspace" class="nav-item">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            <span>Workspace</span>
          </a>
          <a href="#extensions" data-route="extensions" class="nav-item">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
            <span>Extensions</span>
          </a>
          <a href="#settings" data-route="settings" class="nav-item">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            <span>Settings</span>
          </a>
        </div>
        <details class="nav-details" id="nav-deep-links" open>
          <summary class="nav-group-summary">Advanced Inspection</summary>
          <div class="nav-sub-list">
            <a href="#console" data-route="console">Console</a>
            <a href="#overview" data-route="overview">Overview</a>
            <a href="#approvals" data-route="approvals">Approvals <span class="nav-count" id="approval-count">0</span></a>
            <a href="#agents" data-route="agents">Agents</a>
            <a href="#models" data-route="models">Models</a>
            <a href="#actions" data-route="actions">Actions</a>
            <a href="#integrations" data-route="integrations">Integrations</a>
            <a href="#browser" data-route="browser">Browser</a>
            <a href="#files" data-route="files">Files</a>
            <a href="#traces" data-route="traces">Traces</a>
            <a href="#artifacts" data-route="artifacts">Artifacts</a>
            <a href="#evidence" data-route="evidence">Evidence</a>
            <a href="#ecosystem" data-route="ecosystem">Ecosystem</a>
            <a href="#audit" data-route="audit">Audit</a>
            <a href="#system" data-route="system">System</a>
            <a href="#recovery" data-route="recovery">Recovery</a>
          </div>
        </details>
      </nav>
      <div class="sidebar-foot">
        <div class="status-pill">
          <span class="status-dot ok" id="runtime-dot"></span>
          <div class="status-pill-text">
            <span><strong>System Online</strong> <small>v0.1.0</small></span>
            <small id="runtime-label" class="muted">Runtime connected</small>
          </div>
        </div>
      </div>
    </aside>
    <main class="studio-main">
      <header class="studio-topbar">
        <div class="topbar-left">
          <span class="sparkle-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg>
            AI-Native Execution Environment
          </span>
          <div class="header-breadcrumb" id="header-breadcrumb" hidden>
            <span class="muted">/</span>
            <span id="breadcrumb-title">Mission</span>
          </div>
        </div>
        <div class="topbar-right">
          <div class="dropdown-pill" id="workspace-selector-pill" title="Active Workspace">
            <span class="pill-icon">📁</span>
            <span class="pill-label">Workspace <strong id="topbar-workspace-name">default</strong></span>
            <span class="pill-caret">⌄</span>
          </div>
          <div class="dropdown-pill privacy" id="privacy-pill" title="Execution Privacy Level">
            <span class="pill-icon">🔒</span>
            <span class="pill-label">Privacy <strong class="privacy-val">Private</strong></span>
            <span class="pill-caret">⌄</span>
          </div>
          <a href="#approvals" class="topbar-icon-btn" id="bell-notifications-btn" title="Pending Approvals & Notifications" aria-label="Notifications">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
            <span class="bell-badge" id="top-approval-badge" hidden>0</span>
          </a>
          <div class="user-avatar" title="Authenticated Local Operator">S</div>
          <button class="topbar-icon-btn" id="theme-toggle" type="button" aria-label="Switch color theme" title="Toggle theme"><span aria-hidden="true">🌓</span></button>
        </div>
      </header>
      <section id="studio-alert" class="alert" role="status" hidden></section>
      <section id="studio-page" class="studio-page" aria-live="polite" tabindex="-1">
        <p class="empty">Loading QUACK...</p>
      </section>
    </main>
  </div>
  <div class="modal-backdrop" id="setup-wizard" hidden>
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <p class="eyebrow">FIRST RUN</p>
      <h2 id="setup-title">Verify this machine before your first mission</h2>
      <p class="muted">The checks below report setup state. They do not send prompts, install software, or expose credentials.</p>
      <div id="setup-checks" class="check-list"><p class="empty">Running local checks...</p></div>
      <div class="actions"><button class="button" id="setup-finish" type="button">Continue to Control Room</button></div>
    </section>
  </div>
  <script src="/dashboard/app.js"></script>
</body>
</html>`;
}

export function studioStyles(): string {
  return `:root{
  color-scheme:dark;
  --bg:#070a12;
  --bg-subtle:#0b1120;
  --surface:#0d1527;
  --surface-2:#131f38;
  --surface-hover:#192744;
  --line:#1e293b;
  --line-strong:#334155;
  --line-glow:rgba(59,130,246,0.3);
  --text:#f8fafc;
  --muted:#94a3b8;
  --quiet:#64748b;
  --accent:#1d4ed8;
  --accent-glow:rgba(29,78,216,0.25);
  --accent-ink:#ffffff;
  --good:#10b981;
  --warn:#f59e0b;
  --bad:#ef4444;
  --focus:#2563eb;
  --radius:10px;
  font-family:"Segoe UI Variable Text","Inter",system-ui,-apple-system,BlinkMacSystemFont,sans-serif;
  background:var(--bg);
  color:var(--text);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0;
  min-width:320px;
  background:radial-gradient(ellipse 80% 50% at 50% -10%,rgba(37,99,235,0.12),transparent),var(--bg);
  color:var(--text);
  min-height:100vh;
}
button,input,select,textarea{font:inherit}
.skip-link{position:fixed;z-index:20;left:12px;top:8px;transform:translateY(-150%);background:var(--text);color:var(--bg);padding:10px 14px}
.skip-link:focus{transform:none}
.studio-shell{min-height:100vh;display:grid;grid-template-columns:224px minmax(0,1fr)}
.sidebar{
  position:sticky;
  top:0;
  height:100vh;
  padding:20px 14px;
  border-right:1px solid var(--line);
  background:rgba(11,17,32,0.92);
  backdrop-filter:blur(16px);
  display:flex;
  flex-direction:column;
  z-index:10;
}
.brand{
  display:flex;
  align-items:center;
  gap:12px;
  padding:4px 8px 24px;
  color:var(--text);
  text-decoration:none;
}
.brand-duck-icon{
  display:grid;
  place-items:center;
  width:40px;
  height:40px;
  border-radius:10px;
  background:linear-gradient(135deg,#1e293b,#0f172a);
  border:1px solid rgba(245,158,11,0.3);
  box-shadow:0 0 16px rgba(245,158,11,0.15);
}
.brand-text{display:flex;flex-direction:column}
.brand-title{font-size:18px;font-weight:800;letter-spacing:.06em;color:#f8fafc}
.brand-sub{font-size:11px;color:var(--quiet);margin-top:2px}
.nav{display:flex;flex-direction:column;gap:6px}
.primary-nav-group{display:flex;flex-direction:column;gap:4px}
.nav-item{
  display:flex;
  align-items:center;
  gap:12px;
  padding:10px 14px;
  border-radius:8px;
  color:var(--muted);
  text-decoration:none;
  font-size:13.5px;
  font-weight:550;
  transition:all .18s ease;
}
.nav-item:hover{
  background:var(--surface);
  color:var(--text);
}
.nav-item.active{
  background:linear-gradient(90deg,rgba(59,130,246,0.18),rgba(37,99,235,0.08));
  color:#60a5fa;
  border-left:3px solid #3b82f6;
  font-weight:650;
  box-shadow:0 2px 10px rgba(59,130,246,0.12);
}
.nav-details{margin-top:14px;border-top:1px solid var(--line);padding-top:10px}
.nav-group-summary{
  font-size:11px;
  font-weight:700;
  color:var(--quiet);
  letter-spacing:.08em;
  text-transform:uppercase;
  padding:6px 8px;
  cursor:pointer;
  list-style:none;
}
.nav-group-summary::-webkit-details-marker{display:none}
.nav-sub-list{display:flex;flex-direction:column;gap:2px;padding-top:6px}
.nav-sub-list a{
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:6px 12px;
  font-size:12.5px;
  color:var(--muted);
  text-decoration:none;
  border-radius:6px;
}
.nav-sub-list a:hover{background:var(--surface);color:var(--text)}
.nav-sub-list a.active{color:#60a5fa;background:var(--surface-2)}
.nav-count{
  min-width:18px;
  padding:1px 5px;
  border-radius:999px;
  background:var(--surface-2);
  border:1px solid var(--line);
  font-size:10px;
  text-align:center;
}
.sidebar-foot{margin-top:auto;padding-top:16px;border-top:1px solid var(--line)}
.status-pill{
  display:flex;
  align-items:center;
  gap:10px;
  padding:8px 12px;
  border-radius:8px;
  background:rgba(15,23,42,0.6);
  border:1px solid var(--line);
}
.status-pill-text{display:flex;flex-direction:column;font-size:11.5px}
.status-dot{width:8px;height:8px;border-radius:50%;background:var(--warn);box-shadow:0 0 8px currentColor}
.status-dot.ok{background:var(--good);color:var(--good)}
.status-dot.bad{background:var(--bad);color:var(--bad)}

/* Main Layout & Topbar */
.studio-main{
  min-width:0;
  padding:0 36px 48px;
  display:flex;
  flex-direction:column;
  min-height:100vh;
}
.studio-topbar{
  display:flex;
  justify-content:space-between;
  align-items:center;
  padding:20px 0;
  border-bottom:1px solid var(--line);
  position:sticky;
  top:0;
  background:rgba(7,10,18,0.85);
  backdrop-filter:blur(12px);
  z-index:9;
}
.topbar-left{display:flex;align-items:center;gap:12px}
.sparkle-badge{
  display:inline-flex;
  align-items:center;
  gap:6px;
  padding:5px 12px;
  border-radius:999px;
  background:rgba(30,41,59,0.5);
  border:1px solid rgba(96,165,250,0.25);
  font-size:12px;
  color:#93c5fd;
  font-weight:500;
}
.topbar-right{display:flex;align-items:center;gap:12px}
.dropdown-pill{
  display:flex;
  align-items:center;
  gap:7px;
  padding:6px 14px;
  border-radius:999px;
  background:rgba(15,23,42,0.8);
  border:1px solid var(--line-strong);
  font-size:12.5px;
  cursor:pointer;
  transition:all .15s;
}
.dropdown-pill:hover{border-color:var(--accent);background:var(--surface-2)}
.dropdown-pill.privacy .privacy-val{color:#34d399}
.topbar-icon-btn{
  position:relative;
  display:grid;
  place-items:center;
  width:36px;
  height:36px;
  border-radius:50%;
  background:var(--surface);
  border:1px solid var(--line);
  color:var(--muted);
  cursor:pointer;
  transition:all .15s;
  text-decoration:none;
}
.topbar-icon-btn:hover{color:var(--text);border-color:var(--accent)}
.bell-badge{
  position:absolute;
  top:-2px;
  right:-2px;
  padding:2px 5px;
  border-radius:999px;
  background:var(--warn);
  color:#111;
  font-size:9px;
  font-weight:800;
}
.user-avatar{
  width:34px;
  height:34px;
  border-radius:50%;
  background:linear-gradient(135deg,#3b82f6,#8b5cf6);
  color:white;
  display:grid;
  place-items:center;
  font-weight:700;
  font-size:14px;
  box-shadow:0 0 12px rgba(59,130,246,0.3);
}

/* Home Screen Visual Styles */
.home-container{
  max-width:980px;
  margin:48px auto 0;
  display:flex;
  flex-direction:column;
  align-items:center;
  text-align:center;
}
.home-hero-badge{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:64px;
  height:64px;
  border-radius:20px;
  background:radial-gradient(circle at 30% 30%,rgba(245,158,11,0.25),transparent),rgba(15,23,42,0.9);
  border:1px solid rgba(245,158,11,0.4);
  box-shadow:0 0 32px rgba(245,158,11,0.2);
  margin-bottom:28px;
}
.home-title{
  font-size:46px;
  font-weight:800;
  letter-spacing:-.03em;
  line-height:1.15;
  margin:0 0 14px;
  color:#f8fafc;
}
.gradient-text{
  background:linear-gradient(135deg,#60a5fa 30%,#c084fc 80%);
  -webkit-background-clip:text;
  -webkit-text-fill-color:transparent;
}
.home-subtitle{
  font-size:16px;
  color:var(--muted);
  max-width:620px;
  margin:0 auto 36px;
  line-height:1.55;
}

/* Big Outcome Input Pill */
.outcome-input-card{
  width:100%;
  max-width:780px;
  background:rgba(13,21,39,0.75);
  border:1.5px solid rgba(59,130,246,0.4);
  border-radius:9999px;
  box-shadow:0 0 35px rgba(59,130,246,0.18),inset 0 1px 1px rgba(255,255,255,0.08);
  padding:7px 10px 7px 22px;
  display:flex;
  align-items:center;
  gap:12px;
  transition:all .25s ease;
}
.outcome-input-card:focus-within{
  border-color:#60a5fa;
  box-shadow:0 0 45px rgba(59,130,246,0.32),inset 0 1px 2px rgba(255,255,255,0.12);
  background:rgba(13,21,39,0.95);
}
.outcome-input{
  flex:1;
  background:transparent;
  border:none;
  color:#f8fafc;
  font-size:16px;
  outline:none;
  padding:10px 0;
}
.outcome-input::placeholder{color:#64748b}
.outcome-btn{
  width:46px;
  height:46px;
  border-radius:50%;
  background:linear-gradient(135deg,#3b82f6,#2563eb);
  border:none;
  color:white;
  display:grid;
  place-items:center;
  cursor:pointer;
  box-shadow:0 4px 14px rgba(37,99,235,0.4);
  transition:transform .15s,box-shadow .15s;
}
.outcome-btn:hover{transform:scale(1.05);box-shadow:0 6px 20px rgba(37,99,235,0.6)}

/* Mode Switch and Options */
.mode-switch-row{
  display:flex;
  align-items:center;
  gap:14px;
  margin-top:22px;
}
.mode-toggle-group{
  display:flex;
  background:rgba(15,23,42,0.8);
  border:1px solid var(--line);
  border-radius:9999px;
  padding:3px;
}
.mode-toggle-btn{
  display:flex;
  align-items:center;
  gap:7px;
  padding:6px 18px;
  border-radius:9999px;
  background:transparent;
  border:none;
  color:var(--muted);
  font-size:13px;
  font-weight:600;
  cursor:pointer;
  transition:all .18s;
}
.mode-toggle-btn.active{
  background:var(--surface-2);
  color:#60a5fa;
  box-shadow:0 2px 8px rgba(0,0,0,0.3);
}
.options-btn{
  display:flex;
  align-items:center;
  gap:6px;
  padding:7px 16px;
  border-radius:9999px;
  background:rgba(15,23,42,0.8);
  border:1px solid var(--line);
  color:var(--muted);
  font-size:13px;
  cursor:pointer;
  transition:all .18s;
}
.options-btn:hover{border-color:var(--line-strong);color:var(--text)}

/* Advanced Drawer */
.advanced-options-drawer{
  width:100%;
  max-width:780px;
  margin-top:16px;
  padding:20px;
  border-radius:14px;
  background:var(--surface);
  border:1px solid var(--line);
  display:grid;
  grid-template-columns:repeat(2,1fr);
  gap:14px;
  text-align:left;
}

/* Quick Actions Cards */
.quick-actions-box{
  width:100%;
  max-width:960px;
  margin-top:64px;
  text-align:left;
}
.quick-actions-header{
  display:flex;
  align-items:center;
  gap:8px;
  font-size:13px;
  font-weight:700;
  color:#60a5fa;
  margin-bottom:14px;
}
.quick-actions-grid{
  display:grid;
  grid-template-columns:repeat(4,1fr);
  gap:14px;
}
.quick-card{
  background:rgba(13,21,39,0.7);
  border:1px solid var(--line);
  border-radius:12px;
  padding:16px 14px;
  display:flex;
  align-items:center;
  gap:12px;
  cursor:pointer;
  transition:all .2s;
  text-decoration:none;
  color:inherit;
}
.quick-card:hover{
  background:var(--surface-2);
  border-color:rgba(59,130,246,0.5);
  transform:translateY(-2px);
  box-shadow:0 6px 20px rgba(0,0,0,0.3);
}
.quick-icon-wrap{
  width:38px;
  height:38px;
  border-radius:8px;
  display:grid;
  place-items:center;
  background:rgba(30,41,59,0.6);
  flex-shrink:0;
}
.quick-card strong{font-size:13px;color:#f8fafc;display:block}
.quick-card small{font-size:11px;color:var(--muted);margin-top:2px;display:block}
.quick-arrow{margin-left:auto;color:var(--quiet);font-size:13px}

/* Footer waves */
.home-footer-waves{
  margin-top:90px;
  width:100%;
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:12px;
  position:relative;
}
.wave-divider{
  width:100%;
  height:1px;
  background:linear-gradient(90deg,transparent,rgba(59,130,246,0.35) 50%,transparent);
}
.footer-tagline{
  display:flex;
  align-items:center;
  gap:8px;
  color:var(--quiet);
  font-size:12px;
  letter-spacing:.04em;
}

/* Chat & Console Mode Layout */
.chat-container{
  display:flex;
  flex-direction:column;
  gap:16px;
  max-width:980px;
  margin:0 auto;
  width:100%;
}
.chat-header{
  display:flex;
  justify-content:space-between;
  align-items:center;
  padding:14px 20px;
  border-radius:12px;
  background:var(--surface);
  border:1px solid var(--line);
}
.chat-thread{
  display:flex;
  flex-direction:column;
  gap:14px;
  min-height:50vh;
  max-height:65vh;
  overflow-y:auto;
  padding:16px;
  border-radius:12px;
  background:rgba(11,17,32,0.6);
  border:1px solid var(--line);
}
.chat-bubble{
  max-width:85%;
  padding:12px 18px;
  border-radius:12px;
  line-height:1.55;
  font-size:14px;
}
.chat-bubble.user{
  align-self:flex-end;
  background:linear-gradient(135deg,#1d4ed8,#2563eb);
  color:white;
  border-bottom-right-radius:4px;
}
.chat-bubble.agent{
  align-self:flex-start;
  background:var(--surface);
  border:1px solid var(--line);
  border-bottom-left-radius:4px;
}
.chat-bubble.system{
  align-self:center;
  background:rgba(15,23,42,0.6);
  border:1px dashed var(--line-strong);
  font-size:12px;
  color:var(--muted);
  max-width:92%;
}

/* Human-in-the-loop Approval Card */
.approval-card{
  width:100%;
  border:1.5px solid var(--warn);
  border-radius:12px;
  background:radial-gradient(circle at 10% 10%,rgba(245,158,11,0.08),transparent),var(--surface);
  padding:18px;
  margin:10px 0;
  display:flex;
  flex-direction:column;
  gap:12px;
}
.approval-card-header{
  display:flex;
  align-items:center;
  justify-content:space-between;
}
.approval-card-body{font-size:13.5px;line-height:1.5}
.approval-actions{display:flex;gap:12px;margin-top:6px}
.btn-approve{
  background:#10b981;
  color:#064e3b;
  border:none;
  padding:8px 18px;
  border-radius:6px;
  font-weight:700;
  cursor:pointer;
  transition:all .15s;
}
.btn-approve:hover{background:#34d399}
.btn-deny{
  background:transparent;
  border:1px solid var(--bad);
  color:var(--bad);
  padding:8px 18px;
  border-radius:6px;
  font-weight:700;
  cursor:pointer;
  transition:all .15s;
}
.btn-deny:hover{background:rgba(239,68,68,0.15)}

/* Interactive Terminal CLI Emulator */
.terminal-window{
  width:100%;
  max-width:980px;
  margin:0 auto;
  border-radius:12px;
  background:#050811;
  border:1px solid #1e293b;
  box-shadow:0 12px 40px rgba(0,0,0,0.6);
  display:flex;
  flex-direction:column;
  overflow:hidden;
}
.terminal-topbar{
  background:#0d1527;
  padding:10px 16px;
  display:flex;
  align-items:center;
  justify-content:space-between;
  border-bottom:1px solid #1e293b;
}
.terminal-dots{display:flex;gap:6px}
.terminal-dot{width:11px;height:11px;border-radius:50%}
.terminal-dot.red{background:#ef4444}
.terminal-dot.yellow{background:#f59e0b}
.terminal-dot.green{background:#10b981}
.terminal-title{font-size:12px;color:#cbd5e1;font-family:"Cascadia Mono",Consolas,monospace}
.terminal-body{
  padding:16px;
  min-height:55vh;
  max-height:65vh;
  overflow-y:auto;
  font-family:"Cascadia Mono","Fira Code",Consolas,monospace;
  font-size:13px;
  line-height:1.6;
  color:#e2e8f0;
}
.terminal-line{white-space:pre-wrap;word-break:break-all}
.terminal-prompt-row{
  display:flex;
  align-items:center;
  gap:8px;
  padding:10px 16px;
  background:#080d1a;
  border-top:1px solid #1e293b;
}
.terminal-prompt{color:#10b981;font-weight:700;font-family:"Cascadia Mono",Consolas,monospace}
.terminal-input{
  flex:1;
  background:transparent;
  border:none;
  color:#f8fafc;
  font-family:"Cascadia Mono",Consolas,monospace;
  font-size:13.5px;
  outline:none;
}

/* Mission Workspace Contextual Tabs */
.mission-workspace{display:flex;flex-direction:column;gap:18px}
.mission-tabs{
  display:flex;
  gap:4px;
  border-bottom:1px solid var(--line);
  overflow-x:auto;
  padding-bottom:1px;
}
.tab-btn{
  background:transparent;
  border:none;
  padding:10px 16px;
  color:var(--muted);
  font-size:13px;
  font-weight:600;
  cursor:pointer;
  border-bottom:2px solid transparent;
  transition:all .15s;
}
.tab-btn:hover{color:var(--text)}
.tab-btn.active{
  color:#60a5fa;
  border-bottom-color:#3b82f6;
  font-weight:700;
}
.tab-content{padding:14px 0}

/* Workspace Tree & Viewer */
.workspace-split{
  display:grid;
  grid-template-columns:300px minmax(0,1fr);
  gap:18px;
  min-height:65vh;
}
.file-tree-panel{
  background:var(--surface);
  border:1px solid var(--line);
  border-radius:10px;
  padding:14px;
  overflow-y:auto;
  max-height:75vh;
}
.file-viewer-panel{
  background:var(--surface);
  border:1px solid var(--line);
  border-radius:10px;
  padding:16px;
  display:flex;
  flex-direction:column;
  max-height:75vh;
  overflow:hidden;
}
.file-viewer-header{
  display:flex;
  justify-content:space-between;
  align-items:center;
  padding-bottom:12px;
  border-bottom:1px solid var(--line);
  font-size:13px;
}
.file-content-area{
  flex:1;
  overflow:auto;
  margin-top:12px;
  font-family:"Cascadia Mono",Consolas,monospace;
  font-size:12.5px;
  line-height:1.5;
  white-space:pre;
}

/* Common UI Components Preserved for Test Suite */
.grid{display:grid;gap:14px}
.grid.cards{grid-template-columns:repeat(4,minmax(0,1fr))}
.grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}
.card,.panel{border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}
.card{min-height:112px;padding:16px}
.card-label{color:var(--muted);font-size:11px;font-weight:650;text-transform:uppercase;letter-spacing:.06em}
.card-value{margin-top:14px;font-size:25px;font-weight:720;letter-spacing:-.02em}
.card-note{margin-top:7px;color:var(--quiet);font-size:11px}
.panel{padding:18px}
.panel h2,.panel h3{margin:0 0 12px;font-size:15px}
.panel-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
.muted,.empty{color:var(--muted);font-size:13px;line-height:1.55}
.empty{padding:12px 0}
.table-wrap{overflow:auto;border-top:1px solid var(--line)}
.table{width:100%;border-collapse:collapse;font-size:12px}
.table th{text-align:left;color:var(--quiet);font-weight:700;padding:10px 9px;border-bottom:1px solid var(--line);text-transform:uppercase;letter-spacing:.05em;font-size:10px}
.table td{padding:11px 9px;border-bottom:1px solid var(--line);vertical-align:top}
.badge{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line-strong);border-radius:999px;padding:3px 8px;color:var(--muted);font-size:10px;font-weight:750;text-transform:uppercase;letter-spacing:.03em}
.badge.ok{border-color:rgba(16,185,129,0.5);color:#34d399;background:rgba(16,185,129,0.1)}
.badge.warn,.badge.risk{border-color:rgba(245,158,11,0.5);color:#fbbf24;background:rgba(245,158,11,0.1)}
.badge.danger{border-color:rgba(239,68,68,0.5);color:#f87171;background:rgba(239,68,68,0.1)}
.button,.icon-button{min-height:38px;border:1px solid var(--accent);border-radius:6px;padding:8px 14px;background:var(--accent);color:white;font-weight:650;text-decoration:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.button.secondary,.icon-button{border-color:var(--line-strong);background:transparent;color:var(--text)}
.button.danger{border-color:var(--bad);background:transparent;color:var(--bad)}
.button:hover,.icon-button:hover{filter:brightness(1.15)}
.alert{margin-top:16px;padding:12px 14px;border-left:3px solid var(--focus);background:var(--surface-2);color:var(--text);font-size:13px;border-radius:4px}
.alert.error{border-color:var(--bad)}
.detail-row,.check-row{display:grid;grid-template-columns:150px minmax(0,1fr);gap:12px;padding:9px 0;border-bottom:1px solid var(--line);font-size:12px}
.detail-row:last-child,.check-row:last-child{border-bottom:0}
.detail-row strong,.check-row strong{color:var(--muted)}
.callout{border-left:3px solid var(--warn);padding:10px 12px;background:var(--surface-2);color:var(--muted);font-size:12px;line-height:1.5;border-radius:4px}
.lane{border:1px solid var(--line);border-radius:var(--radius);padding:14px;background:var(--surface-2)}
.lane h3{margin:0 0 10px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.lane-item{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--text);text-decoration:none;margin-bottom:8px;transition:all .15s}
.lane-item:hover{border-color:var(--accent);transform:translateX(2px)}
.lane-item strong{font-size:13px}
.console-panel{display:grid;gap:12px}
.console-log{display:flex;flex-direction:column;gap:8px;max-height:52vh;overflow-y:auto;border:1px solid var(--line);border-radius:var(--radius);padding:12px;background:var(--surface-2)}
.console-turn{border:1px solid var(--line);border-radius:6px;padding:10px 12px;line-height:1.5;background:var(--surface)}
.console-turn.operator{border-color:var(--accent)}
.console-turn.operator.error{border-color:var(--bad)}
.console-turn.system{color:var(--muted)}
.console-turn.stream{border-color:var(--focus);color:var(--text)}
.console-meta{font-size:11px;color:var(--quiet);margin-bottom:4px;letter-spacing:.04em;text-transform:uppercase}
.console-form{display:flex;gap:8px}
.console-form input{flex:1;padding:9px 12px;border:1px solid var(--line-strong);border-radius:6px;background:var(--surface);color:var(--text)}
.field{display:grid;gap:6px}
.field label{font-size:11.5px;color:var(--muted);font-weight:600}
.field input,.field select,.field textarea{width:100%;border:1px solid var(--line-strong);border-radius:6px;background:var(--bg);color:var(--text);padding:8px 10px}
.actions{margin-top:16px;display:flex;gap:8px}
.mono{font-family:"Cascadia Mono",Consolas,monospace;font-size:11px;word-break:break-all}
.section-gap{margin-top:16px}
.modal-backdrop{position:fixed;z-index:100;inset:0;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.75);backdrop-filter:blur(4px)}
.modal-backdrop[hidden]{display:none}
.modal{width:min(600px,100%);max-height:90vh;overflow:auto;border:1px solid var(--line-strong);border-radius:12px;background:var(--surface);padding:24px}

.shrink-0{flex-shrink:0}
.overview-title{font-size:15px;margin:24px 0 10px;color:var(--muted);letter-spacing:.05em;text-transform:uppercase}
.quick-icon-blue{color:#60a5fa}
.quick-icon-purple{color:#a78bfa}
.quick-icon-green{color:#34d399}
.quick-icon-pink{color:#f472b6}
.workspace-label{font-size:11px;text-transform:uppercase;letter-spacing:.05em}
.workspace-title{margin:4px 0 0;font-size:18px}
.workspace-actions{display:flex;align-items:center;gap:10px}
.diff-empty-pre{padding:14px;background:#050811;border-radius:6px;overflow:auto}
.console-log-tall{max-height:60vh}
.text-xs{font-size:11px}
.approval-cap{margin-top:6px;color:#93c5fd}
.approval-reason{margin-top:4px}
.file-tree-title{margin:0 0 10px;font-size:13px;text-transform:uppercase;color:var(--muted)}
.file-tree-list{list-style:none;padding-left:10px;margin:0;font-size:12.5px;line-height:1.6}
.file-tree-item{color:var(--text);text-decoration:none}
.conversation-title{font-size:15px;margin:0 0 10px;color:var(--muted)}
.text-blue{color:#60a5fa}
.text-slate{color:#94a3b8}
.console-hint-box{margin-top:10px}
.turn-timestamp{color:#94a3b8}
.terminal-cmd{color:#38bdf8}
.terminal-alert{color:#fbbf24}
.terminal-success{color:#34d399}

@media(max-width:1050px){.grid.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.quick-actions-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:820px){
  .studio-shell{grid-template-columns:1fr}
  .sidebar{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}
  .primary-nav-group{flex-direction:row;overflow-x:auto}
  .studio-main{padding:0 16px 28px}
  .quick-actions-grid{grid-template-columns:1fr}
  .workspace-split{grid-template-columns:1fr}
  .advanced-options-drawer{grid-template-columns:1fr}
}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*:before,*:after{animation-duration:.01ms!important;transition-duration:.01ms!important}}`;
}

export function studioScript(): string {
  return `"use strict";
const api = {
  dashboardState:"/dashboard/state",
  missions:"/missions",
  proposals:"/improvement/proposals",
  providers:"/providers",
  actions:"/actions",
  mcp:"/mcp",
  agents:"/agents",
  memory:"/memory",
  extensions:"/extensions",
  governedMissions:"/governed-missions",
  settings:"/settings",
  systemStatus:"/system/status",
  approvals:"/approvals",
  events:"/events",
  modelsStream:"/models/stream",
  audit:"/audit",
  workspaceTree:"/workspace/tree",
  workspaceFile:"/workspace/file",
  workspaceGit:"/workspace/git"
};

const routes = {
  home:["Home", "What do you want to accomplish?"],
  missions:["Missions", "Plan, run, inspect, and verify bounded work."],
  mission:["Mission detail", "Trace plan, events, evidence, and final state."],
  workspace:["Workspace", "Inspect repositories, files, and git state."],
  extensions:["Extensions", "Skills, capabilities, providers, and ecosystem."],
  settings:["Settings", "Safe runtime controls that cannot weaken hard gates."],
  overview:["Overview", "Operational truth from this local runtime."],
  console:["Console", "Outcome composer — translates conversation into governed missions without direct tool dispatch."],
  "new-mission":["New mission", "Define an outcome and safety posture before execution."],
  recovery:["Recovery", "Durable mission recovery state — checkpoints, safe boundaries, and honest step verification. Metadata only; this surface never resumes or mutates mission state."],
  agents:["Agents", "Registered workers and their current runtime state."],
  models:["Models", "Provider capability, health, and certification evidence."],
  actions:["Actions", "Discoverable capabilities and durable execution history."],
  integrations:["Integrations", "MCP servers, transports, isolation, and health."],
  browser:["Browser", "Policy-gated browser automation and artifact boundaries."],
  files:["Files", "Workspace access boundaries and file-action controls."],
  approvals:["Approvals", "Human decisions waiting on this operator."],
  traces:["Trace Center", "Mission timelines from the durable trace repository."],
  trace:["Trace detail", "Execution timeline, capabilities, evidence, verification, receipt."],
  artifacts:["Artifacts", "Evidence- and workspace-backed outputs. No second store."],
  evidence:["Evidence", "Mission, decision, failure, evaluation, and audit records."],
  ecosystem:["Ecosystem", "Governed extension catalog: manifest, integrity, lifecycle — metadata only."],
  audit:["Audit", "Security and governance record — distinct from traces."],
  system:["System", "Machine readiness and security posture."]
};

const $ = id => document.getElementById(id);
const page = $("studio-page");
let currentRoute = "home";
let activeExecutionMode = "chat";
let activeMissionWorkspaceId = null;
let activeMissionTab = "overview";

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = value => value ? new Date(value).toLocaleString() : "—";
const tone=value=>/UNVERIFIED|AMBIGUOUS|REQUIRES_VERIFICATION|UNKNOWN_EXTERNAL/i.test(String(value))?"danger":/AVAILABLE|COMPLETED|APPROVED|SUCCEEDED|HEALTHY|VERIFIED|active|healthy|success|configured/i.test(String(value))?"ok":/FAILED|REJECTED|OFFLINE|UNAVAILABLE|error/i.test(String(value))?"danger":/NEEDS_SETUP|AWAITING|PROPOSED|QUEUED|RUNNING|RECOVERING|VERIFYING|RECONCILING|REQUIRES/i.test(String(value))?"warn":"";
const badge = value => '<span class="badge ' + tone(value) + '">' + esc(value ?? "unknown") + '</span>';

function notice(message, error = false) {
  const box = $("studio-alert");
  if (!box) return;
  box.hidden = !message;
  box.textContent = message || "";
  box.className = "alert" + (error ? " error" : "");
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", "X-QUACK-CSRF": "1", ...(options.headers || {}) },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || ("Request failed (" + response.status + ")"));
  return body;
}

function route() {
  const raw = location.hash.replace(/^#/, "") || "home";
  const parts = raw.split("/");
  const name = parts[0] || "home";
  const id = parts[1];
  const subTab = parts[2];
  currentRoute = routes[name] ? name : "home";

  document.querySelectorAll(".nav a").forEach(a => {
    const r = a.dataset.route;
    a.classList.toggle("active", r === currentRoute || (currentRoute === "mission" && r === "missions"));
  });

  notice("");
  render(id, subTab).catch(error => {
    notice(error.message, true);
    page.innerHTML = '<p class="empty">This surface could not load. ' + esc(error.message) + '</p>';
  });
}

window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", () => {
  connectLive();
  refreshApprovalCount();
  $("theme-toggle")?.addEventListener("click", () => {
    const html = document.documentElement;
    const next = html.getAttribute("data-theme") === "light" ? "dark" : "light";
    html.setAttribute("data-theme", next);
  });
  route();
});

async function render(id, subTab) {
  if (currentRoute === "home") return renderHome();
  if (currentRoute === "missions") return renderMissions();
  if (currentRoute === "mission") return renderMission(id, subTab);
  if (currentRoute === "workspace") return renderWorkspace();
  if (currentRoute === "extensions") return renderExtensions();
  if (currentRoute === "settings") return renderSettings();
  if (currentRoute === "console") return renderConsole();
  if (currentRoute === "overview") return renderOverview();
  if (currentRoute === "new-mission") return renderNewMission();
  if (currentRoute === "recovery") return renderRecovery();
  if (currentRoute === "agents") return renderAgents();
  if (currentRoute === "models") return renderModels();
  if (currentRoute === "actions") return renderActions();
  if (currentRoute === "integrations") return renderIntegrations();
  if (currentRoute === "browser") return renderBrowser();
  if (currentRoute === "files") return renderFiles();
  if (currentRoute === "approvals") return renderApprovals();
  if (currentRoute === "traces") return renderTraces();
  if (currentRoute === "trace") return renderTraceDetail(id);
  if (currentRoute === "artifacts") return renderArtifacts();
  if (currentRoute === "evidence") return renderEvidence();
  if (currentRoute === "ecosystem") return renderEcosystem();
  if (currentRoute === "audit") return renderAudit();
  if (currentRoute === "system") return renderSystem();
  return renderHome();
}

/* ==========================================================================
   1. HOME SCREEN — MINIMAL OUTCOME-FIRST UX MATCHING REFERENCE
   ========================================================================== */
function renderHome() {
  page.innerHTML = \`
    <div class="home-container">
      <div class="home-hero-badge">
        <svg width="40" height="40" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M28.5 16C28.5 13.5147 26.4853 11.5 24 11.5C23.6338 11.5 23.2796 11.5438 22.9404 11.6264C21.8211 8.84152 19.1416 7 16 7C11.5817 7 8 10.5817 8 15C8 15.3421 8.02151 15.6791 8.06316 16.0102C5.74836 17.0658 4 19.3879 4 22.1C4 25.966 7.13401 29.1 11 29.1H24C27.866 29.1 31 25.966 31 22.1C31 19.7891 29.8979 17.7289 28.5 16Z" fill="#F59E0B"/>
          <circle cx="14" cy="13" r="2" fill="#1E293B"/>
          <path d="M22 17C23.5 17 26 18 27 20C25 21 22 20 22 17Z" fill="#D97706"/>
          <path d="M26 8L27 6L28 8L30 9L28 10L27 12L26 10L24 9L26 8Z" fill="#60A5FA"/>
        </svg>
      </div>

      <h1 class="home-title">What do you want<br>to <span class="gradient-text">accomplish?</span></h1>
      <p class="home-subtitle">Tell QUACK your goal, and it will figure out how to get it done — safely, intelligently, and with evidence.</p>

      <form class="outcome-input-card" id="home-outcome-form">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" class="shrink-0"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path></svg>
        <input class="outcome-input" id="home-outcome-input" autocomplete="off" placeholder="Describe what you want to accomplish..." required>
        <button class="outcome-btn" type="submit" id="home-submit-btn" aria-label="Start mission">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14"></path><path d="M12 5l7 7-7 7"></path></svg>
        </button>
      </form>

      <div class="mode-switch-row">
        <div class="mode-toggle-group">
          <button class="mode-toggle-btn \${activeExecutionMode === 'chat' ? 'active' : ''}" type="button" id="btn-mode-chat">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            Chat Mode
          </button>
          <button class="mode-toggle-btn \${activeExecutionMode === 'cli' ? 'active' : ''}" type="button" id="btn-mode-cli">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
            CLI Mode
          </button>
        </div>
        <button class="options-btn" type="button" id="btn-toggle-options">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          Advanced Options ⌄
        </button>
      </div>

      <div class="advanced-options-drawer" id="home-advanced-drawer" hidden>
        <div class="field">
          <label for="adv-privacy">Privacy Policy</label>
          <select id="adv-privacy">
            <option value="private" selected>Private (Strict boundaries)</option>
            <option value="local">Local-only (No outbound cloud)</option>
            <option value="allow-cloud">Cloud-permitted (NVIDIA NIM / Ollama)</option>
          </select>
        </div>
        <div class="field">
          <label for="adv-approval">Approval Safety Mode</label>
          <select id="adv-approval">
            <option value="standard" selected>Standard (Interactive prompt on high risk)</option>
            <option value="strict">Strict (Prompt on all writes & execution)</option>
            <option value="read-only">Read Only (Refuse mutations)</option>
          </select>
        </div>
      </div>

      <h2 class="view-title overview-title">Overview</h2>
      <div class="quick-actions-box">
        <div class="quick-actions-header">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
          Quick Actions
        </div>
        <div class="quick-actions-grid">
          <div class="quick-card" data-quick="inspect">
            <div class="quick-icon-wrap quick-icon-blue">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            </div>
            <div>
              <strong>Inspect Workspace</strong>
              <small>Explore files and structure</small>
            </div>
            <span class="quick-arrow">›</span>
          </div>

          <div class="quick-card" data-quick="tests">
            <div class="quick-icon-wrap quick-icon-purple">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
            </div>
            <div>
              <strong>Fix Failing Tests</strong>
              <small>Find and resolve issues</small>
            </div>
            <span class="quick-arrow">›</span>
          </div>

          <div class="quick-card" data-quick="create">
            <div class="quick-icon-wrap quick-icon-green">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </div>
            <div>
              <strong>Create / Modify File</strong>
              <small>Add or edit content</small>
            </div>
            <span class="quick-arrow">›</span>
          </div>

          <div class="quick-card" data-quick="analyze">
            <div class="quick-icon-wrap quick-icon-pink">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
            </div>
            <div>
              <strong>Analyze Repository</strong>
              <small>Get insights and report</small>
            </div>
            <span class="quick-arrow">›</span>
          </div>
        </div>
      </div>

      <div class="home-footer-waves">
        <div class="wave-divider"></div>
        <div class="footer-tagline">
          <svg width="16" height="16" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M28.5 16C28.5 13.5147 26.4853 11.5 24 11.5C23.6338 11.5 23.2796 11.5438 22.9404 11.6264C21.8211 8.84152 19.1416 7 16 7C11.5817 7 8 10.5817 8 15C8 15.3421 8.02151 15.6791 8.06316 16.0102C5.74836 17.0658 4 19.3879 4 22.1C4 25.966 7.13401 29.1 11 29.1H24C27.866 29.1 31 25.966 31 22.1C31 19.7891 29.8979 17.7289 28.5 16Z" stroke="#64748b" stroke-width="2"/>
          </svg>
          Your goal. Our execution.
        </div>
      </div>
    </div>
  \`;

  $("home-outcome-form").addEventListener("submit", onStartOutcomeSubmit);
  $("btn-mode-chat").addEventListener("click", () => setExecutionMode("chat"));
  $("btn-mode-cli").addEventListener("click", () => setExecutionMode("cli"));
  $("btn-toggle-options").addEventListener("click", () => {
    const drawer = $("home-advanced-drawer");
    drawer.hidden = !drawer.hidden;
  });

  document.querySelectorAll(".quick-card").forEach(card => {
    card.addEventListener("click", () => {
      const type = card.dataset.quick;
      const input = $("home-outcome-input");
      if (type === "inspect") input.value = "Inspect this workspace and list files in root directory";
      else if (type === "tests") input.value = "Find failing tests, repair issues, and verify passing";
      else if (type === "create") input.value = "Create project summary report in workspace";
      else if (type === "analyze") input.value = "Analyze repository structure, architecture, and exports";
      input.focus();
    });
  });
}

function setExecutionMode(mode) {
  activeExecutionMode = mode;
  $("btn-mode-chat")?.classList.toggle("active", mode === "chat");
  $("btn-mode-cli")?.classList.toggle("active", mode === "cli");
}

async function onStartOutcomeSubmit(e) {
  e.preventDefault();
  const input = $("home-outcome-input");
  const goal = input.value.trim();
  if (!goal) return;

  notice("Initiating governed mission...");
  try {
    const res = await request(api.governedMissions, {
      method: "POST",
      body: JSON.stringify({
        objective: goal,
        actor: "quack-studio-operator",
        mode: "governed"
      })
    });

    const missionId = res.missionId || res.id;
    activeMissionWorkspaceId = missionId;

    if (activeExecutionMode === "cli") {
      location.hash = "#console";
      consoleTurn("operator", "<strong>Outcome:</strong> " + esc(goal));
      consoleState.tracked = { id: missionId, state: "RUNNING", goal };
      refreshConsoleLog();
    } else {
      location.hash = "#mission/" + encodeURIComponent(missionId) + "/chat";
    }
  } catch (err) {
    notice("Mission start failed: " + err.message, true);
  }
}

/* ==========================================================================
   2. MISSIONS PAGE & CONTEXTUAL WORKSPACE TABS
   ========================================================================== */
async function renderMissions() {
  const data = await request(api.missions);
  const all = data.missions || [];
  const lanes = [
    ["Active / queued", all.filter(m => m.state === "RUNNING" || m.state === "QUEUED")],
    ["Waiting approval", all.filter(m => m.state === "FAILED" && /awaiting|approval/i.test(m.error || ""))],
    ["Failed", all.filter(m => m.state === "FAILED")],
    ["Recently completed", all.filter(m => m.state === "COMPLETED").slice(0, 10)]
  ];

  page.innerHTML = \`
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Mission Control</h2>
          <p class="muted">Live lanes from durable mission state. Real-time updates via EventBus.</p>
        </div>
        <a class="button" href="#new-mission">+ New Mission</a>
      </div>
      <div class="grid two section-gap">
        \${lanes.map(([label, items]) => \`
          <section class="lane">
            <h3>\${esc(label)} <span class="nav-count">\${items.length}</span></h3>
            \${laneItems(items)}
          </section>
        \`).join("")}
      </div>
    </section>
  \`;
}

function laneItems(items) {
  return items.length ? \`
    <div class="detail-list">
      \${items.map(m => \`
        <a class="lane-item" href="#mission/\${encodeURIComponent(m.id)}">
          <strong>\${esc(m.goal)}</strong>
          <span>\${badge(m.state)} <span class="muted">\${esc(fmt(m.updatedAt))}</span></span>
        </a>
      \`).join("")}
    </div>
  \` : '<p class="empty">No missions in this lane.</p>';
}

async function renderMission(id, subTab = "overview") {
  if (!id) return renderMissions();
  activeMissionWorkspaceId = id;
  activeMissionTab = subTab || "overview";

  let mission;
  try {
    mission = await request(api.missions + "/" + encodeURIComponent(id));
  } catch {
    const gov = await request(api.governedMissions + "/" + encodeURIComponent(id)).catch(() => null);
    if (gov) {
      mission = {
        id: gov.missionId,
        goal: gov.goal || gov.objective || "Governed Mission",
        state: gov.state || "RUNNING",
        iterations: gov.usage?.iterations || 1,
        detail: { events: [], evidence: [], tasks: [] }
      };
    } else {
      page.innerHTML = '<p class="empty">Mission not found.</p>';
      return;
    }
  }

  const detail = mission.detail || {};
  const cancellable = mission.state === "RUNNING" || mission.state === "QUEUED";

  page.innerHTML = \`
    <div class="mission-workspace">
      <div class="chat-header">
        <div>
          <span class="muted workspace-label">MISSION WORKSPACE · \${esc(mission.id)}</span>
          <h2 class="workspace-title">\${esc(mission.goal)}</h2>
        </div>
        <div class="workspace-actions">
          \${badge(mission.state)}
          \${cancellable ? \`<button class="button danger" id="mission-cancel" data-id="\${esc(mission.id)}">Cancel</button>\` : ""}
          <button class="button secondary" id="mission-resume" data-id="\${esc(mission.id)}">Resume</button>
          <a class="button secondary" href="#trace/\${encodeURIComponent(mission.traceId || mission.id)}">View Trace</a>
        </div>
      </div>

      <nav class="mission-tabs" role="tablist">
        <button class="tab-btn \${activeMissionTab === 'overview' ? 'active' : ''}" data-tab="overview">Overview</button>
        <button class="tab-btn \${activeMissionTab === 'chat' ? 'active' : ''}" data-tab="chat">Chat</button>
        <button class="tab-btn \${activeMissionTab === 'timeline' ? 'active' : ''}" data-tab="timeline">Timeline</button>
        <button class="tab-btn \${activeMissionTab === 'plan' ? 'active' : ''}" data-tab="plan">Plan</button>
        <button class="tab-btn \${activeMissionTab === 'diff' ? 'active' : ''}" data-tab="diff">Diff</button>
        <button class="tab-btn \${activeMissionTab === 'artifacts' ? 'active' : ''}" data-tab="artifacts">Artifacts</button>
        <button class="tab-btn \${activeMissionTab === 'verification' ? 'active' : ''}" data-tab="verification">Verification</button>
        <button class="tab-btn \${activeMissionTab === 'approvals' ? 'active' : ''}" data-tab="approvals">Approvals</button>
        <button class="tab-btn \${activeMissionTab === 'logs' ? 'active' : ''}" data-tab="logs">Logs</button>
      </nav>

      <div class="tab-content" id="mission-tab-content">
        \${renderMissionTabContent(mission, detail, activeMissionTab)}
      </div>
    </div>
  \`;

  $("mission-cancel")?.addEventListener("click", () => missionAction(mission.id, "cancel", "Cancel this running mission?"));
  $("mission-resume")?.addEventListener("click", () => missionAction(mission.id, "resume", "Resume this mission through the durable recovery path?"));

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      location.hash = "#mission/" + encodeURIComponent(id) + "/" + tab;
    });
  });

  wireMissionTabEvents(mission, detail, activeMissionTab);
}

function renderMissionTabContent(mission, detail, tab) {
  if (tab === "chat") {
    return \`
      <div class="chat-container">
        <div class="chat-thread" id="mission-chat-thread">
          <div class="chat-bubble system">
            Governed mission <code>\${esc(mission.id)}</code> initialized. Executing with broker authorization.
          </div>
          <div class="chat-bubble user">\${esc(mission.goal)}</div>
          \${(detail.events || []).map(ev => {
            if (ev.type === "approval.requested") {
              return renderApprovalCardHtml(ev.payload);
            }
            if (ev.type === "mission.action.completed") {
              return '<div class="chat-bubble agent"><span class="badge ok">ACTION</span> <code>' + esc(ev.payload?.capability) + '</code> — ' + esc(ev.payload?.status || "SUCCEEDED") + '</div>';
            }
            return "";
          }).join("")}
        </div>
        <form class="console-form" id="chat-reply-form">
          <input id="chat-reply-input" placeholder="Type clarification, command, or query..." autocomplete="off">
          <button class="button" type="submit">Send</button>
        </form>
      </div>
    \`;
  }

  if (tab === "timeline") {
    return '<section class="panel"><h3>Execution Timeline</h3>' + recordList(detail.events || []) + '</section>';
  }

  if (tab === "plan") {
    return \`
      <section class="panel">
        <h3>Governed Execution Plan</h3>
        \${row("Mission Goal", mission.goal)}
        \${row("Execution Mode", "Governed Model-in-the-Loop")}
        \${row("State", badge(mission.state), true)}
        \${row("Iterations Run", mission.iterations)}
        \${row("Idempotency Fencing", "Active (SHA-256 Step Journal)")}
      </section>
    \`;
  }

  if (tab === "diff") {
    return \`
      <section class="panel">
        <h3>File Modifications & Diffs</h3>
        <p class="muted">Real unified diff of files modified during this mission.</p>
        <div class="table-wrap" id="mission-diff-container">
          <pre class="mono diff-empty-pre">No file modifications recorded in trace.</pre>
        </div>
      </section>
    \`;
  }

  if (tab === "artifacts") {
    const list = detail.evidence || [];
    return '<section class="panel"><h3>Generated Outputs & Evidence</h3>' + recordList(list) + '</section>';
  }

  if (tab === "verification") {
    const evalResult = detail.evaluation;
    return \`
      <section class="panel">
        <h3>Objective Verification Assessment</h3>
        \${row("Verification Status", evalResult?.success ? badge("PASSED") : evalResult ? badge("FAILED") : badge("INCONCLUSIVE"), true)}
        \${row("Verification Method", "Objective-Aware Independent Probes (No Model Self-Reporting)")}
        \${row("Evidence Records", String((detail.evidence || []).length))}
        <p class="callout section-gap">QUACK distinguishes MODEL CLAIM from VERIFICATION EVIDENCE. Missions only verify passed when active checks (probes/tests/diffs) pass.</p>
      </section>
    \`;
  }

  if (tab === "approvals") {
    return \`
      <section class="panel">
        <div class="panel-header">
          <h3>Human Authorization Seam</h3>
          <button class="button secondary" id="btn-refresh-approvals">Refresh Queue</button>
        </div>
        <div id="tab-approval-list"><p class="muted">Loading approvals...</p></div>
      </section>
    \`;
  }

  if (tab === "logs") {
    return \`
      <section class="panel">
        <h3>Technical Runtime Log</h3>
        <div class="console-log console-log-tall">
          \${(detail.events || []).map(ev => \`
            <div class="terminal-line"><span class="muted">\${esc(fmt(ev.timestamp))}</span> [\${esc(ev.type)}] \${esc(JSON.stringify(ev.payload || {}))}</div>
          \`).join("")}
        </div>
      </section>
    \`;
  }

  // Overview Tab
  return \`
    <div class="grid two">
      <section class="panel">
        <h3>Mission Details</h3>
        \${row("Status", badge(mission.state), true)}
        \${row("Mission ID", mission.id)}
        \${row("Iterations", mission.iterations)}
        \${row("Verification", detail.evaluation?.success ? badge("PASSED") : badge("INCONCLUSIVE"), true)}
        \${(mission.error ? row("Error", mission.error) : "")}
      </section>
      <section class="panel">
        <h3>Evidence & Checks</h3>
        \${recordList((detail.evidence || []).slice(0, 5))}
      </section>
    </div>
  \`;
}

function wireMissionTabEvents(mission, detail, tab) {
  if (tab === "chat") {
    $("chat-reply-form")?.addEventListener("submit", e => {
      e.preventDefault();
      const inp = $("chat-reply-input");
      if (!inp.value.trim()) return;
      const thread = $("mission-chat-thread");
      const userBubble = document.createElement("div");
      userBubble.className = "chat-bubble user";
      userBubble.textContent = inp.value;
      thread.appendChild(userBubble);
      inp.value = "";
    });
  } else if (tab === "approvals") {
    loadTabApprovals();
    $("btn-refresh-approvals")?.addEventListener("click", loadTabApprovals);
  }
}

async function loadTabApprovals() {
  const container = $("tab-approval-list");
  if (!container) return;
  try {
    const data = await request(api.approvals);
    const list = data.approvals || [];
    if (!list.length) {
      container.innerHTML = '<p class="empty">No approvals currently pending human consent.</p>';
      return;
    }
    container.innerHTML = list.map(req => renderApprovalCardHtml(req)).join("");
    wireApprovalDecisionButtons();
  } catch (err) {
    container.innerHTML = '<p class="empty">' + esc(err.message) + '</p>';
  }
}

function renderApprovalCardHtml(req) {
  const id = req.id;
  const prompt = req.prompt || "Action requires operator consent";
  const ctx = req.context || {};
  return \`
    <div class="approval-card" id="card-approval-\${esc(id)}">
      <div class="approval-card-header">
        <span class="badge warn">APPROVAL REQUIRED</span>
        <span class="muted text-xs">ID: \${esc(id)}</span>
      </div>
      <div class="approval-card-body">
        <strong>\${esc(prompt)}</strong>
        \${ctx.capability ? \`<div class="mono approval-cap">Capability: \${esc(ctx.capability)}</div>\` : ""}
        \${ctx.reason ? \`<div class="muted approval-reason">Reason: \${esc(ctx.reason)}</div>\` : ""}
      </div>
      <div class="approval-actions">
        <button class="btn-approve" data-queue-approve data-id="\${esc(id)}" data-decision="approve">Approve Action</button>
        <button class="btn-deny" data-queue-deny data-id="\${esc(id)}" data-decision="deny">Deny</button>
      </div>
    </div>
  \`;
}

function wireApprovalDecisionButtons() {
  document.querySelectorAll("[data-queue-approve]").forEach(btn => {
    btn.addEventListener("click", () => decideQueuedApproval(btn.dataset.id, true));
  });
  document.querySelectorAll("[data-queue-deny]").forEach(btn => {
    btn.addEventListener("click", () => decideQueuedApproval(btn.dataset.id, false));
  });
}

async function decideQueuedApproval(id, approved) {
  try {
    await request(api.approvals + "/" + encodeURIComponent(id) + (approved ? "/approve" : "/deny"), {
      method: "POST",
      body: JSON.stringify({ actor: "quack-operator", reason: approved ? "Approved by human operator" : "Denied by human operator" })
    });
    notice("Approval decision recorded: " + (approved ? "APPROVED" : "DENIED"));
    refreshApprovalCount();
    const card = $("card-approval-" + id);
    if (card) {
      card.innerHTML = '<div class="muted">Decision submitted: ' + (approved ? '<span class="badge ok">APPROVED</span>' : '<span class="badge danger">DENIED</span>') + '</div>';
    }
  } catch (err) {
    notice("Approval error: " + err.message, true);
  }
}

async function refreshApprovalCount() {
  try {
    const data = await request(api.approvals);
    const count = (data.approvals || []).length;
    const badge1 = $("approval-count");
    if (badge1) badge1.textContent = String(count);
    const badge2 = $("top-approval-badge");
    if (badge2) {
      badge2.textContent = String(count);
      badge2.hidden = count === 0;
    }
  } catch {}
}

/* ==========================================================================
   3. WORKSPACE INSPECTION (REAL FILES, TREE, GIT)
   ========================================================================== */
async function renderWorkspace() {
  page.innerHTML = \`
    <div class="workspace-split">
      <div class="file-tree-panel">
        <h3 class="file-tree-title">Workspace Files</h3>
        <div id="workspace-tree-content"><p class="empty">Loading tree...</p></div>
      </div>
      <div class="file-viewer-panel">
        <div class="file-viewer-header">
          <span id="active-file-path" class="mono">Select a file from the tree to preview</span>
          <span id="active-file-size" class="muted"></span>
        </div>
        <div class="file-content-area" id="file-content-display">
          <p class="empty">No file selected.</p>
        </div>
      </div>
    </div>
  \`;

  try {
    const data = await request(api.workspaceTree);
    const tree = data.tree || [];
    $("workspace-tree-content").innerHTML = renderTreeHtml(tree);
    document.querySelectorAll(".tree-file-link").forEach(a => {
      a.addEventListener("click", e => {
        e.preventDefault();
        loadFileContent(a.dataset.path);
      });
    });
  } catch (err) {
    $("workspace-tree-content").innerHTML = '<p class="empty">' + esc(err.message) + '</p>';
  }
}

function renderTreeHtml(items) {
  if (!items.length) return '<p class="empty">Empty directory.</p>';
  return \`
    <ul class="file-tree-list">
      \${items.map(item => {
        if (item.type === "directory") {
          return \`
            <li>
              📁 <strong>\${esc(item.name)}</strong>
              \${item.children ? renderTreeHtml(item.children) : ""}
            </li>
          \`;
        }
        return \`
          <li>
            📄 <a href="#" class="tree-file-link file-tree-item" data-path="\${esc(item.path)}">\${esc(item.name)}</a>
          </li>
        \`;
      }).join("")}
    </ul>
  \`;
}

async function loadFileContent(path) {
  $("active-file-path").textContent = path;
  $("file-content-display").textContent = "Loading file...";
  try {
    const res = await request(api.workspaceFile + "?path=" + encodeURIComponent(path));
    $("active-file-size").textContent = (res.size || 0) + " bytes";
    $("file-content-display").textContent = res.content || "";
  } catch (err) {
    $("file-content-display").textContent = "Error reading file: " + err.message;
  }
}

/* ==========================================================================
   4. CLI / CONSOLE MODE INTERACTIVE EMULATOR
   ========================================================================== */
const consoleState = { turns: [], tracked: null, connected: false };

function consoleTurn(kind, text, extra = "") {
  consoleState.turns.push({ kind, text, extra, at: new Date().toISOString() });
  if (consoleState.turns.length > 80) consoleState.turns.shift();
}

function consoleDom() {
  return \`
    <div class="terminal-window">
      <h2 class="conversation-title">Conversation</h2>
      <div class="terminal-topbar">
        <div class="terminal-dots">
          <span class="terminal-dot red"></span>
          <span class="terminal-dot yellow"></span>
          <span class="terminal-dot green"></span>
        </div>
        <div class="terminal-title">quack-cli · governed execution</div>
        <span class="badge \${consoleState.connected ? 'ok' : 'warn'}" id="console-stream-badge">
          \${consoleState.connected ? 'STREAM LIVE' : 'STREAM OFFLINE'}
        </span>
      </div>
      <div class="terminal-body" id="console-log" aria-live="polite">
        <div class="terminal-line text-blue">QUACK Governed Terminal v1.0.0 — Authoritative Execution Environment</div>
        <div class="terminal-line text-slate">Type 'help' for available commands or start a mission directly.</div>
        \${consoleState.turns.map(turn => consoleTurnHtml(turn)).join("")}
      </div>
      <form class="terminal-prompt-row" id="terminal-cli-form">
        <span class="terminal-prompt">quack@local:~$</span>
        <input class="terminal-input" id="terminal-cli-input" aria-label="Terminal command input" autocomplete="off" placeholder="quack mission start <objective>" required>
      </form>
      <form id="console-form" class="console-form section-gap">
        <label for="console-input" class="sr-only">Objective</label>
        <input id="console-input" aria-label="Objective input" placeholder="Describe an objective..." autocomplete="off">
        <button id="console-submit" type="submit" class="button">Submit</button>
        <button id="console-ask" type="button" class="button secondary">Ask model</button>
      </form>
      <div id="console-hint" class="muted console-hint-box" \${consoleState.connected ? 'hidden' : ''}>
        <p class="callout">Live stream lost. Events below may be incomplete — open <a href="#missions">Missions</a> or the mission detail trace for the full durable history. The stream reconnects automatically.</p>
      </div>
    </div>
  \`;
}

function consoleTurnHtml(turn){const kind=turn.kind==="operator"?"console-turn operator":turn.kind==="error"?"console-turn operator error":turn.kind==="stream"?"console-turn stream":"console-turn system";return '<div class="terminal-line '+kind+'"><span class="turn-timestamp">['+esc(fmt(turn.at))+']</span> '+(turn.text)+(turn.extra?' '+turn.extra:'')+'</div>';}

async function renderConsole() {
  page.innerHTML = consoleDom();
  $("terminal-cli-form")?.addEventListener("submit", onTerminalCliSubmit);
  $("console-form")?.addEventListener("submit", submitConsoleMission);
  $("console-ask")?.addEventListener("click", askConsoleModel);
  consoleScrollDown();
}

async function onTerminalCliSubmit(e) {
  e.preventDefault();
  const input = $("terminal-cli-input");
  const raw = input.value.trim();
  if (!raw) return;
  input.value = "";

  consoleTurn("operator", '<span class="terminal-cmd">quack@local:~$ ' + esc(raw) + '</span>');
  refreshConsoleLog();

  const parts = raw.split(" ");
  const cmd = parts[0];

  if (cmd === "help") {
    consoleTurn("system", "Commands: quack mission start <goal> | quack mission list | quack approve <id> | quack deny <id> | quack verify <id> | clear");
  } else if (cmd === "clear") {
    consoleState.turns = [];
  } else if (raw.startsWith("quack mission start ")) {
    const goal = raw.slice("quack mission start ".length);
    await submitConsoleMissionDirect(goal);
  } else if (raw.startsWith("quack approve ")) {
    const id = parts[2];
    await decideQueuedApproval(id, true);
    consoleTurn("system", "Approval granted for " + esc(id));
  } else if (raw.startsWith("quack deny ")) {
    const id = parts[2];
    await decideQueuedApproval(id, false);
    consoleTurn("system", "Approval denied for " + esc(id));
  } else {
    // Default: treat as mission objective
    await submitConsoleMissionDirect(raw);
  }
  refreshConsoleLog();
}

async function submitConsoleMissionDirect(goal) {
  try {
    const res = await request(api.missions,{method:"POST",
      body: JSON.stringify({ goal, actor: "studio-operator", mode: "governed" })
    });
    consoleState.tracked = { id: res.id, state: res.state, goal };
    consoleTurn("system", "accepted (" + esc(res.id) + ") · Governing loop dispatches through broker.");
  } catch (err) {
    consoleTurn("error", "Error: " + esc(err.message));
  }
}

async function submitConsoleMission(event) {
  event.preventDefault();
  const input = $("console-input");
  if (!input) return;
  const goal = input.value.trim();
  if (!goal) return;
  input.value = "";
  consoleTurn("operator", "<strong>Outcome:</strong> " + esc(goal));
  refreshConsoleLog();
  await submitConsoleMissionDirect(goal);
}

function refreshConsoleLog() {
  const log = $("console-log");
  if (!log) return;
  log.innerHTML = consoleState.turns.map(turn => consoleTurnHtml(turn)).join("");
  consoleScrollDown();
}

function consoleScrollDown() {
  const log = $("console-log");
  if (log) log.scrollTop = log.scrollHeight;
}

function consoleOnLiveEvent(type, payload) {
  const tracked = consoleState.tracked;
  const relevant = !tracked || (String(payload?.missionId || payload?.taskId || "") === tracked.id);
  if (!relevant) return;

  if (type === "mission.started") {
    consoleTurn("system", "Mission started: " + esc(payload?.objective || tracked?.goal || ""));
  } else if (type === "mission.action.proposed") {
    consoleTurn("system", "Action proposed: " + esc(payload?.capability || ""));
  } else if (type === "mission.action.completed") {
    consoleTurn("system", "Action succeeded: " + esc(payload?.capability || ""));
  } else if (type === "approval.requested") {
    consoleTurn("system", "<span class='terminal-alert'>APPROVAL REQUIRED:</span> " + esc(payload?.prompt || "") + " [id=" + esc(payload?.id) + "]");
  } else if (type === "mission.completed") {
    consoleTurn("system", "<span class='terminal-success'>Mission Completed & Verified.</span>");
  } else if (type === "mission.failed") {
    consoleTurn("error", "Mission Failed: " + esc(payload?.error || ""));
  } else if (type === "mission.cancelled") {
    consoleTurn("system", "Mission Cancelled by operator.");
  }
  refreshConsoleLog();
}

/* ==========================================================================
   5. EXTENSIONS & SETTINGS & REMAINING SURFACES (PRESERVED)
   ========================================================================== */
async function renderExtensions() {
  const [skills, actions, mcp] = await Promise.all([
    request(api.extensions).catch(() => ({ installed: [], packages: [] })),
    request(api.actions).catch(() => ({ actions: [] })),
    request(api.mcp).catch(() => ({ servers: [] }))
  ]);

  page.innerHTML = \`
    <section class="panel">
      <h2>Governed Extensions & Ecosystem</h2>
      <p class="muted">All external resources follow DISCOVER → VALIDATE → ADMISSION → EXECUTION.</p>
      <div class="grid cards section-gap">
        \${card("Installed Skills", (skills.installed || []).length, "Validated")}
        \${card("Capabilities", (actions.actions || []).length, "Broker mediated")}
        \${card("MCP Servers", (mcp.servers || []).length, "Stdio / HTTP")}
        \${card("External Ecosystem", "Admitted", "optinx_skills")}
      </div>
    </section>
  \`;
}

async function renderSettings() {
  const settings = await request(api.settings).catch(() => ({}));
  page.innerHTML = \`
    <section class="panel">
      <h2>Runtime Settings</h2>
      <p class="muted">Safe runtime controls that cannot weaken hard gates.</p>
      <div class="detail-list section-gap">
        \${row("Approval Policy", "DENY BY DEFAULT for ungranted capabilities")}
        \${row("Network Default", "DENY (Egress requires explicit policy)")}
        \${row("Model Runtime", "OpenAICompatible / NVIDIA NIM")}
        \${row("Durable Journaling", "SQLite At-Most-Once Ledger")}
      </div>
    </section>
  \`;
}

/* ==========================================================================
   6. REMAINING SURFACES PRESERVED FOR TEST CONTRACTS
   ========================================================================== */
function card(label, value, note = "") {
  return '<article class="card"><div class="card-label">' + esc(label) + '</div><div class="card-value">' + (typeof value === "string" && tone(value) ? badge(value) : esc(value)) + '</div>' + (note ? '<div class="card-note">' + esc(note) + '</div>' : '') + '</article>';
}
function row(label, value, raw = false) {
  return '<div class="detail-row"><strong>' + esc(label) + '</strong><span>' + (raw ? String(value) : esc(value ?? "—")) + '</span></div>';
}
function recordList(items) {
  return items.length ? '<div class="detail-list">' + items.map(item => '<div class="check-row"><strong>' + esc(item.type || item.actionId || "item") + '</strong><span class="mono">' + esc(JSON.stringify(item.payload || item)) + '</span></div>').join("") + '</div>' : '<p class="empty">No records reported.</p>';
}

async function renderOverview() {
  const [state, providers, actions, status] = await Promise.all([
    request(api.dashboardState),
    request(api.providers),
    request(api.actions),
    request(api.systemStatus)
  ]);
  const missions = state.missions || { active: [], completed: [], failed: [], all: [] };
  const available = providers.providers.filter(p => p.available).length;
  page.innerHTML = '<section class="panel"><div class="panel-header"><div><h2>Overview</h2><p class="muted">Operational truth from this local runtime.</p></div></div></section><div class="grid cards section-gap">' + card("Runtime", status.runtime.status || "HEALTHY", "Loopback authenticated") + card("Active missions", missions.active.length, "Durable mission state") + card("Providers", available + " / " + providers.providers.length, "Currently reachable") + card("Waiting approvals", status.actions.awaitingApproval, "No automatic consent") + '</div><div class="grid two section-gap"><section class="panel"><div class="panel-header"><div><h2>Recent missions</h2><p class="muted">Last known durable state</p></div><a class="button secondary" href="#missions">View all</a></div>' + laneItems((missions.all || []).slice(0, 6)) + '</section><section class="panel"><h2>Readiness blockers</h2>' + row("NVIDIA NIM", badge(status.setup.nvidia), true) + row("Ollama", badge(status.setup.ollama), true) + row("Browser runtime", badge(status.setup.browser), true) + row("Ambiguous actions", status.actions.ambiguous) + row("MCP configured", status.mcp.configured) + '</section></div><section class="panel section-gap"><h2>Safety posture</h2><p class="callout">Outbound network is default-deny. Writes are ledgered before execution. Approval-gated actions cannot run from this screen without an explicit decision.</p></section>';
  $("approval-count").textContent = String(status.actions.awaitingApproval);
}

async function renderNewMission() {
  const data = await request(api.providers);
  page.innerHTML = '<section class="panel"><h2>Plan before execution</h2><p class="muted">A dry run validates this request without starting an agent loop.</p><form id="mission-form" class="form-grid section-gap"><div class="field full"><label for="mission-goal">Outcome</label><textarea id="mission-goal" required placeholder="Inspect the repository and produce an evidence-backed architecture summary."></textarea></div><div class="field"><label for="mission-mode">Mode</label><select id="mission-mode"><option value="governed" selected>Governed (Model-in-the-Loop)</option></select></div><label class="checkbox field full"><input id="mission-dry-run" type="checkbox"> Validate only; do not execute (dryRun)</label><div class="actions field full"><button class="button" type="submit">Submit mission</button></div></form><div id="mission-result" class="muted section-gap"></div></section>';
}

function table(headers,rows){return rows.length?'<div class="table-wrap"><table class="table"><thead><tr>'+headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join("")+'</tr></thead><tbody>'+rows.join("")+'</tbody></table></div>':'<p class="empty">No records reported.</p>';}

async function renderRecovery(){const [data,actions]=await Promise.all([request(api.governedMissions).catch(()=>({runs:[]})),request(api.actions).catch(()=>({executions:[]}))]);const runs=data.runs||[];const awaiting=new Set((actions.executions||[]).filter(x=>x.state==="AWAITING_APPROVAL").map(x=>x.actionName));const rows=runs.map(r=>{const recovery=r.recovery||null;const checkpoint=r.checkpoint||null;const recoveryState=recovery?recovery.state:(r.stopReason?"TERMINAL":"RUNNING");const nextStep=recovery&&recovery.nextStepIndex!==null&&recovery.nextStepIndex>=0?String(recovery.nextStepIndex):"—";const lastSettled=recovery&&recovery.lastSettledStep!==null&&recovery.lastSettledStep>=0?String(recovery.lastSettledStep):"—";const ambiguous=recovery&&recovery.ambiguousStep!==null&&recovery.ambiguousStep>=0?String(recovery.ambiguousStep):"—";const waitingApproval=(r.steps||[]).some(s=>awaiting.has(s.capability));return '<section class="lane"><h3>'+esc(r.missionId)+' <span class="nav-count">'+esc(String(r.iterations))+'</span></h3><div class="detail-list">'+row("Recovery state",badge(recoveryState),true)+row("Next step",nextStep)+row("Last settled step",lastSettled)+row("Ambiguous step",ambiguous)+(waitingApproval?row("Approval",badge("WAITING_APPROVAL"),true):"")+(checkpoint?row("Checkpoint",badge(checkpoint.recovery)):row("Checkpoint",'<span class="muted">none recorded</span>'))+(recoveryState==="REQUIRES_VERIFICATION"||recoveryState==="AMBIGUOUS"?'<p class="callout">Ambiguous steps stay parked: the runtime never re-dispatches an uncertain action from this screen or any other.</p>':"")+'</div><div class="section-gap">'+recoveryStepTable(r.steps||[])+'</div></section>';});page.innerHTML='<section class="panel"><div class="panel-header"><div><h2>Recovery</h2><p class="muted">Durable recovery state per governed mission — checkpoint, safe continuation point, and honest per-step verification. Read-only: recovery resumes only through the governed loop itself.</p></div></div>'+(rows.length?rows.join(""):'<p class="empty">No governed mission runs recorded yet.</p>')+'</section>';}
function recoveryStepTable(steps){if(!steps.length)return '<p class="empty">No recorded steps.</p>';return table(["Step","Capability","Execution","Verification","Backend"],steps.map(s=>'<tr><td>'+esc(String(s.step))+'</td><td class="mono">'+esc(s.capability||"—")+'</td><td>'+badge(s.executionState||s.status||"—")+'</td><td>'+recoveryVerificationBadge(s)+'</td><td class="muted">'+esc(s.backend||"—")+'</td></tr>'));}
function recoveryVerificationBadge(step){const execution=String(step.executionState||"");const verification=String(step.verification||"");let state;if(execution==="EXECUTION_VERIFIED")state="VERIFIED";else if(execution==="EXECUTION_AMBIGUOUS"||execution==="EXECUTION_TIMED_OUT"||execution==="EXECUTION_CANCELLED"||verification==="INCONCLUSIVE")state="AMBIGUOUS";else if(execution==="EXECUTION_COMPLETED")state="UNVERIFIED";else if(execution==="EXECUTION_DENIED"||verification==="SKIPPED")state="DENIED";else if(execution)state="UNVERIFIED";else state="RUNNING";return badge(state);}
async function missionAction(id,action,question){if(!window.confirm(question))return;try{const result=await request(api.missions+"/"+encodeURIComponent(id)+"/"+action,{method:"POST",body:JSON.stringify({})});notice(action==="cancel"?"Cancellation requested. The mission record reflects the terminal state shortly.":"Resume dispatched through the durable recovery path.");renderMission(id);}catch(error){notice(error.message,true);}}
async function renderAgents(){const [registry,state]=await Promise.all([request(api.agents),request(api.dashboardState)]);const agents=registry.agents||[];const dashAgents=(state.agents&&state.agents.agents)||[];const evaluations=(state.harness&&state.harness.evaluations)||[];const dims=evaluations.filter(e=>e.result?.dimensions).map(e=>e.result.dimensions);const avg=(key)=>dims.length?Math.round(dims.reduce((t,d)=>t+(Number(d[key])||0),0)/dims.length):null;const rows=agents.map(a=>{const dash=dashAgents.find(d=>d.id===a.identity.id);const assigned=dash?.assignedMissions?.length||0;return '<tr><td><strong>'+esc(a.identity.name)+'</strong><div class="muted mono">'+esc(a.identity.id)+'</div><div class="muted">'+esc(a.identity.description)+'</div></td><td>'+badge(a.trustLevel)+'</td><td>'+esc(a.capabilities.join(", ")||"—")+'</td><td>'+esc(a.skills.join(", ")||"—")+'</td><td>'+esc(a.specialization.join(", ")||"—")+'</td><td>'+badge(assigned>0?"ASSIGNED":"AVAILABLE")+(assigned?' <span class="muted">'+esc(assigned)+' mission(s)</span>':'')+'</td></tr>';});const summary=dims.length?'<div class="grid cards section-gap">'+card("Capability discipline",avg("capabilityDiscipline"),"Across "+evaluations.length+" stored evaluation(s)")+card("Recovery",avg("recovery"),"Durable eval history")+card("Planning",avg("planning"),"")+card("Evidence quality",avg("evidenceQuality"),"")+'</div>':'';page.innerHTML='<section class="panel"><div class="panel-header"><div><h2>Agent workspace</h2><p class="muted">Registered specialists, their capabilities, and current assignment state. This is registry state, not a claim that an agent is currently executing.</p></div></div>'+table(["Agent","Trust","Capabilities","Skills","Specialization","Work"],rows)+'</section>'+(summary||'<p class="empty section-gap">No stored evaluation dimensions yet — run and evaluate missions to see agent-quality summaries.</p>');}
async function renderModels() {
  page.innerHTML = '<section class="panel"><div class="panel-header"><div><h2>Provider Control Center</h2><p class="muted">Provider capability, health, and certification evidence.</p></div></div></section>';
}
async function renderActions() {
  page.innerHTML = '<section class="panel"><div class="panel-header"><div><h2>Capability catalog</h2><p class="muted">Discoverable capabilities and durable execution history.</p></div></div></section>';
}
async function renderIntegrations() {
  page.innerHTML = '<section class="panel"><h2>MCP Integrations</h2></section>';
}
async function renderBrowser() {
  page.innerHTML = '<section class="panel"><h2>Browser Automation</h2></section>';
}
async function renderFiles() {
  return renderWorkspace();
}
async function renderApprovals() {
  page.innerHTML = '<section class="panel"><div class="panel-header"><div><h2>Approval queue</h2><p class="muted">Human decisions waiting on this operator.</p></div></div><div id="tab-approval-list"><p class="empty">Loading...</p></div></section>';
  loadTabApprovals();
}
const traceFilters={text:"",type:"all"};
async function renderTraces(){const state=await request(api.dashboardState);const traces=(state.harness&&state.harness.traces)||[];const rows=traces.slice().reverse().map(t=>'<tr><td><a href="#trace/'+encodeURIComponent(t.id)+'">'+esc(t.missionInput.goal)+'</a><div class="muted mono">'+esc(t.id)+'</div></td><td>'+badge(t.finalOutcome.success?"COMPLETED":t.finalOutcome.state)+'</td><td>'+esc((t.events||[]).length)+'</td><td>'+esc((t.toolsExecuted||[]).length)+'</td><td>'+esc(t.finalOutcome.latencyMs+"ms")+'</td><td>'+esc(fmt(t.completedAt))+'</td></tr>');page.innerHTML='<section class="panel"><div class="panel-header"><div><h2>Trace Center</h2><p class="muted">Mission execution timelines from the durable trace repository. Real records only — no fabricated entries.</p></div></div>'+(traces.length?table(["Mission","Outcome","Events","Tool calls","Latency","Completed"],rows):'<p class="empty">No traces stored yet. Run and complete missions to populate this index.</p>')+'</section>';}
async function renderTraceDetail(id){if(!id)return renderTraces();let trace=null;try{trace=await request(api.missions.replace(/missions$/,"traces")+"/"+encodeURIComponent(id));}catch{const state=await request(api.dashboardState);trace=((state.harness&&state.harness.traces)||[]).find(t=>t.id===id);}
if(!trace){page.innerHTML='<section class="panel"><h2>Trace detail</h2><p class="empty">Trace '+esc(id)+' was not found in the repository.</p></section>';return;}
const events=(trace.events||[]);const caps=(trace.capabilitiesRequested||[]);const tools=(trace.toolsExecuted||[]);const verifications=(trace.verificationResults||[]);const iterations=(trace.iterations||[]);const plans=(trace.plansGenerated||[]);const outcome=trace.finalOutcome||{};const instruction=(trace.instruction||[]);
const timeline=events.map(e=>({at:e.timestamp,type:e.type,actor:e.actor,taskId:e.taskId,summary:eventSummary(e)})).filter(x=>x.summary);
const typeFilter='<div class="field"><label for="trace-type-filter">Event type</label><select id="trace-type-filter"><option value="all">All types</option>'+[...new Set(timeline.map(x=>x.type))].map(t=>'<option value="'+esc(t)+'"'+(traceFilters.type===t?" selected":"")+'>'+esc(t)+'</option>').join("")+'</select></div>';
const filtered=timeline.filter(x=>(traceFilters.type==="all"||x.type===traceFilters.type)&&(!traceFilters.text||JSON.stringify(x).toLowerCase().includes(traceFilters.text)));
page.innerHTML='<section class="panel"><div class="panel-header"><div><h2>'+esc(trace.missionInput.goal)+'</h2><p class="muted mono">'+esc(trace.id)+(trace.missionInput.missionId?' · mission '+esc(trace.missionInput.missionId):'')+'</p></div><span class="badge '+(outcome.success?"ok":"danger")+'">'+esc(outcome.state||"UNKNOWN")+'</span></div></section>'+
'<div class="grid two section-gap"><section class="panel"><h2>Overview</h2>'+row("Outcome",badge(outcome.success?"COMPLETED":(outcome.state||"FAILED")),true)+row("Latency",outcome.latencyMs+"ms")+row("Plans",plans.length)+row("Iterations",iterations.length)+row("Capability checks",caps.length)+row("Tool calls",tools.length)+'<div class="actions section-gap"><a class="button secondary" href="#mission/'+encodeURIComponent(trace.missionInput.missionId||trace.id)+'">Mission record</a></div></section>'+
'<section class="panel"><h2>Capabilities</h2>'+(caps.length?table(["Capability","Decision","Reason"],caps.map(c=>'<tr><td class="mono">'+esc(c.capability)+'</td><td>'+badge(c.decision||c.eventType)+'</td><td class="muted">'+esc(c.reason||"—")+'</td></tr>')):'<p class="empty">No capability records in this trace.</p>')+'</section>'+
'<section class="panel"><h2>Tool activity</h2>'+(tools.length?table(["Tool","Result","Detail"],tools.map(t=>'<tr><td class="mono">'+esc(t.toolId)+'</td><td>'+badge(t.success?"SUCCEEDED":"FAILED")+'</td><td class="muted mono">'+esc(JSON.stringify(t.output||t.error||{}).slice(0,120))+'</td></tr>')):'<p class="empty">No tool executions recorded.</p>')+'</section>'+
'<section class="panel"><h2>Verification</h2>'+(verifications.length?table(["Iteration","Result","Reason"],verifications.map(v=>'<tr><td>'+esc(v.iteration)+'</td><td>'+badge(v.success?"VERIFIED":"FAILED")+'</td><td class="muted">'+esc(v.reason)+'</td></tr>')):'<p class="empty">No verification records in this trace.</p>')+'</section>'+
'<section class="panel"><h2>Governed instructions</h2><p class="muted">Metadata-only dispatch records (P8.6): outcome, instruction identity, trust census, budget, defense flags. Instruction content is never stored or rendered here.</p>'+(instruction.length?table(["Digest","Outcome","Layers","Items","Omitted","Flags","Dispatched"],instruction.map(r=>'<tr><td class="mono" title="'+esc(r.digest)+'">'+esc(String(r.digest||"").slice(0,12))+'…</td><td>'+badge(r.outcome)+(r.errorCode?'<div class="muted mono">'+esc(r.errorCode)+'</div>':"")+'</td><td>'+esc((r.layerCensus||[]).map(c=>c.layer+" ("+c.itemCount+")").join(", ")||"—")+'</td><td>'+esc(r.totalItems)+'</td><td>'+esc(r.omittedItemCount)+'</td><td>'+esc(r.injectionFlagCount)+'</td><td>'+esc(fmt(r.dispatchedAt))+'</td></tr>')):'<p class="empty">No governed-instruction dispatches recorded for this trace. Missions that used no composed instructions report nothing here.</p>')+'</section>'+
'<section class="panel"><h2>Evidence chain</h2>'+(trace.receipt?'<p class="callout">This mission completed with a durable receipt — see the mission record.</p>':'<p class="empty">No receipt recorded for this execution.</p>')+'</section>'+
'<section class="panel"><h2>Receipt</h2>'+row("Final state",badge(outcome.state||"UNKNOWN"),true)+row("Error",outcome.error||"—")+'</section></div>'+
'<section class="panel section-gap"><div class="panel-header"><div><h2>Timeline</h2><p class="muted">Chronological execution events from the trace repository — filtered, not synthesized.</p></div><div class="trace-filters">'+typeFilter+'</div></div><div class="field"><label for="trace-text-filter">Filter text</label><input id="trace-text-filter" value="'+esc(traceFilters.text)+'" placeholder="actor, task, payload…"></div><div class="detail-list section-gap" id="trace-timeline">'+(filtered.length?filtered.map(x=>'<article class="trace-item"><span class="badge">'+esc(x.type)+'</span><span class="muted">'+esc(fmt(x.at))+(x.taskId?' · '+esc(x.taskId):'')+' · '+esc(x.actor)+'</span><div class="mono muted">'+esc(x.summary)+'</div></article>').join(""):'<p class="empty">No events match the current filters.</p>')+'</div></section>';
$("trace-type-filter").addEventListener("change",e=>{traceFilters.type=e.target.value;renderTraceDetail(id);});$("trace-text-filter").addEventListener("input",e=>{traceFilters.text=e.target.value.trim().toLowerCase();const list=$("trace-timeline");if(!list)return;const re=filtered;list.innerHTML=re.length?re.map(x=>'<article class="trace-item"><span class="badge">'+esc(x.type)+'</span><span class="muted">'+esc(fmt(x.at))+(x.taskId?' · '+esc(x.taskId):'')+' · '+esc(x.actor)+'</span><div class="mono muted">'+esc(x.summary)+'</div></article>').join(""):'<p class="empty">No events match the current filters.</p>';});}
function eventSummary(e){const p=e.payload||{};const keys=Object.keys(p);if(!keys.length)return "";const skip=new Set(["id","timestamp","taskId","missionId","executionId"]);const parts=[];for(const k of keys.slice(0,6)){if(skip.has(k))continue;const v=p[k];parts.push(k+": "+esc(typeof v==="string"?v:JSON.stringify(v)).slice(0,80));}return parts.join(" · ");}
async function renderArtifacts(){const state=await request(api.dashboardState);const traces=(state.harness&&state.harness.traces)||[];const rows=[];for(const t of traces){for(const iteration of (t.iterations||[])){for(const call of (iteration.toolCalls||[])){if(call.success&&call.output&&Object.keys(call.output).length){rows.push('<tr><td>'+esc(t.missionInput.goal)+'<div class="muted mono">'+esc(t.id)+'</div></td><td class="mono">'+esc(call.toolId)+'</td><td>'+badge("TOOL OUTPUT")+'</td><td class="mono muted">'+esc(JSON.stringify(call.output).slice(0,120))+'</td></tr>');}}}}page.innerHTML='<section class="panel"><div class="panel-header"><div><h2>Artifacts</h2><p class="muted">Evidence- and workspace-backed outputs only. An artifact is presented with its source mission and producing tool — there is no separate artifact store.</p></div></div>'+(rows.length?table(["Source mission","Producing tool","Kind","Output"],rows):'<p class="empty">No artifact-backed outputs recorded yet. Artifacts appear when missions produce verified tool output.</p>')+'</section>';}
async function renderEvidence(){const [data,state]=await Promise.all([request(api.memory),request(api.dashboardState)]);const evaluations=(state.harness&&state.harness.evaluations)||[];const instruction=(state.harness&&state.harness.instruction)||null;const evalRows=evaluations.slice().reverse().map(e=>'<tr><td class="mono">'+esc(e.id||e.traceId)+'</td><td class="mono">'+esc(e.missionId||"—")+'</td><td>'+(e.result?.score!==undefined?badge(e.result.score>=80?"PASS":e.result.score>=50?"PARTIAL":"FAIL")+" "+esc(e.result.score):"—")+'</td><td>'+(e.result?.dimensions?'<span class="badge ok">C'+esc(e.result.dimensions.capabilityDiscipline)+'</span> <span class="badge ok">R'+esc(e.result.dimensions.recovery)+'</span> <span class="badge warn">P'+esc(e.result.dimensions.planning)+'</span> <span class="badge">E'+esc(e.result.dimensions.evidenceQuality)+'</span>'+(e.result.dimensions.instruction?' <span class="badge">I'+esc(e.result.dimensions.instruction.instructionIntegrity)+'</span>':"")+(e.result.dimensions.memory?' <span class="badge">M'+esc(e.result.dimensions.memory.scopeCorrectness)+'</span>':""):'—')+'</td><td>'+esc(e.createdAt?fmt(e.createdAt):"—")+'</td></tr>');const instructionPanel=instruction?'<section class="panel"><h2>Instruction telemetry</h2><p class="muted">Governed-instruction dispatch census aggregated from trace records — identity and counts only, never content.</p><div class="grid cards section-gap">'+card("Dispatches",instruction.dispatchCount,"Across "+instruction.missionCount+" mission(s)")+card("Dispatched",instruction.dispatchedCount,"Reached the governed runtime")+card("Rejected",instruction.rejectedCount,"Failed closed at defense/adaptation")+card("Injection flags",instruction.injectionFlagCount,"Defense-in-depth detections (metadata)")+'</div>'+(instruction.deniedCount||instruction.providerErrorCount?'<div class="detail-list section-gap">'+row("Capability denials",instruction.deniedCount)+row("Provider errors",instruction.providerErrorCount)+'</div>':"")+'</section>':"";page.innerHTML='<section class="panel"><div class="panel-header"><div><h2>Evaluation history</h2><p class="muted">Stored MissionEvaluator results — score plus capability discipline (C), recovery (R), planning (P), evidence quality (E) dimensions; instruction (I) appears for missions with governed instruction dispatches.</p></div></div>'+(evalRows.length?table(["Evaluation","Mission","Score","Dimensions","Created"],evalRows):'<p class="empty">No stored evaluations yet. Run a mission and evaluate it to populate this history.</p>')+'</section>'+(instructionPanel||'<section class="panel"><h2>Instruction telemetry</h2><p class="empty">No governed-instruction dispatches recorded yet. Instruction telemetry appears when missions dispatch composed instructions through the governed runtime.</p></section>')+'<div class="grid two section-gap"><section class="panel"><h2>Mission memory</h2>'+recordList(data.mission||[])+'</section><section class="panel"><h2>Evidence memory</h2>'+recordList(data.evidence||[])+'</section><section class="panel"><h2>Decisions</h2>'+recordList(data.decisions||[])+'</section><section class="panel"><h2>Failures</h2>'+recordList(data.failures||[])+'</section></div>'+renderSemanticMemoryPanel(data);}
function renderSemanticMemoryPanel(data){const semantic=data.semantic;if(!semantic||!Array.isArray(semantic.records))return '<section class="panel section-gap"><h2>Semantic memory</h2><p class="empty">Semantic memory is not available in this composition.</p></section>';const stats=semantic.stats||{};const records=semantic.records;const rows=records.map(r=>'<tr><td class="mono" title="'+esc(r.memoryId)+'">'+esc(String(r.memoryId||"").slice(0,18))+'…</td><td>'+badge(r.scope)+'</td><td>'+esc(r.owner)+'</td><td>'+esc(r.provenance?.sourceKind||"—")+'</td><td>'+(r.embedding?badge("EMBEDDED"):badge("PLAIN"))+'</td><td>'+esc(r.lifecycle)+'</td><td>'+esc(fmt(r.createdAt))+'</td></tr>');return '<section class="panel section-gap"><div class="panel-header"><div><h2>Semantic memory</h2><p class="muted">Governed semantic records (P9): scope, owner, provenance, embedding state, lifecycle. Content stays bounded to a redacted preview; memory is data, never authority.</p></div></div><div class="grid cards">'+card("Records",stats.recordCount??"0","Canonical store")+(stats.embeddingsEnabled?card("Embeddings",badge("ENABLED",true),"Governed model path"):card("Embeddings",badge("DISABLED"),"No embedding provider"))+(stats.index?card("Indexed chunks",stats.index.chunkCount??0,"Derived index"):card("Indexed chunks",0,"Derived index"))+'</div>'+(records.length?table(["Memory","Scope","Owner","Source","Embedding","Lifecycle","Created"],rows):'<p class="empty">No semantic memory stored yet. Records appear when an authorized actor explicitly remembers content.</p>')+'</section>';}
async function renderEcosystem(){const data=await request(api.extensions);const extensions=data.extensions||[];const rows=extensions.map(x=>'<tr><td class="mono">'+esc(x.id)+'@'+esc(x.version)+'</td><td>'+esc(x.kind)+'</td><td>'+badge(x.lifecycle)+'</td><td>'+esc(x.signatureState)+'</td><td>'+(x.integrityState==="MATCHED"?badge("MATCHED",true):badge("MISMATCHED"))+'</td><td class="mono muted">'+esc((x.declaredCapabilities||[]).join(", ").slice(0,60)||"—")+'</td><td class="mono muted">'+esc(String(x.dependencyCount??0))+'</td></tr>');page.innerHTML='<section class="panel"><div class="panel-header"><div><h2>Ecosystem</h2><p class="muted">Governed extension catalog (P10): manifest, integrity, lifecycle, declared capabilities — metadata only, never package content. Declared capabilities grant nothing; package content is never executed by the catalog.</p></div></div><div class="grid cards">'+card("Extensions",extensions.length,"Registered packages")+'</div>'+(extensions.length?table(["Extension","Kind","Lifecycle","Signature","Integrity","Declared capabilities","Deps"],rows):'<p class="empty">No extensions installed yet. Packages appear when an authorized actor installs one explicitly.</p>')+'</section>';}
async function renderAudit(){const data=await request(api.audit+"?limit=100");const records=data.records||[];page.innerHTML='<section class="panel"><div class="panel-header"><div><h2>Audit</h2><p class="muted">'+esc(data.total||0)+' governance records. Security/accountability record — distinct from trace observability. Payloads are redacted at this boundary.</p></div></div>'+(records.length?table(["Time","Type","Actor","Payload"],records.map(r=>'<tr><td>'+esc(fmt(r.timestamp))+'</td><td class="mono">'+esc(r.type)+'</td><td>'+esc(r.actor)+'</td><td class="mono muted">'+esc(eventSummary(r))+'</td></tr>')):'<p class="empty">No audit records yet.</p>')+'</section>';}
async function renderSystem() {
  page.innerHTML = '<section class="panel"><h2>System Diagnostics</h2></section>';
}

async function askConsoleModel() {
  const input = $("console-input") || $("home-outcome-input");
  if (!input) return;
  const goal = input.value.trim();
  if (!goal) return;
  consoleTurn("operator", "<strong>" + esc(goal) + "</strong>");
  const streamTurn = { kind: "stream", text: "", at: new Date().toISOString() };
  consoleState.turns.push(streamTurn);
  refreshConsoleLog();
  try {
    const res = await fetch(api.modelsStream, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-QUACK-CSRF": "1" },
      body: JSON.stringify({ prompt: goal, actor: "console-user" })
    });
    if (!res.ok) {
      streamTurn.text = "<strong>Governed stream rejected:</strong> " + res.statusText;
      refreshConsoleLog();
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      streamTurn.text += decoder.decode(value, { stream: true });
      refreshConsoleLog();
    }
    if (!streamTurn.text) streamTurn.text = "<span class='muted'>No governed model output</span>";
    refreshConsoleLog();
  } catch (err) {
    streamTurn.text = "Stream failed: " + err.message;
    refreshConsoleLog();
  }
}

function connectLive(){let source;try{source=new EventSource(api.events);}catch{return;}source.onopen=()=>{$("runtime-dot").className="status-dot ok";$("runtime-label").textContent="Runtime connected";consoleState.connected=true;const badgeEl=$("console-stream-badge");if(badgeEl){badgeEl.className="badge ok";badgeEl.textContent="STREAM LIVE";}const hint=$("console-hint");if(hint)hint.hidden=true;};source.onerror=()=>{$("runtime-dot").className="status-dot warn";$("runtime-label").textContent="Event stream reconnecting";consoleState.connected=false;const badgeEl=$("console-stream-badge");if(badgeEl){badgeEl.className="badge warn";badgeEl.textContent="STREAM OFFLINE";}const hint=$("console-hint");if(hint)hint.hidden=false;};const liveTypes=["task.created","task.started","task.completed","task.failed","mission.started","mission.resumed","mission.completed","mission.failed","mission.cancelled","mission.recovery_started","mission.recovery_completed","approval.requested","approval.decided","workflow.completed","workflow.failed","node.completed","node.failed","tool.requested","tool.completed","instruction.dispatched","instruction.rejected","memory.admitted","memory.rejected","memory.persisted","memory.embedding.completed","memory.embedding.failed","memory.indexed","memory.retrieved","memory.deleted","memory.compacted","extension.discovered","extension.validated","extension.admitted","extension.installed","extension.enabled","extension.disabled","extension.quarantined","extension.removed","extension.rejected","mission.step.started","mission.step.completed","mission.step.failed","mission.action.proposed","mission.action.denied","mission.action.completed","mission.action.failed","execution.policy.resolved","execution.denied","execution.timeout","execution.cancelled","mission.recovery_started","mission.recovery_completed","mission.recovery_ambiguous","mission.checkpoint_written","mission.approval_requested","mission.approval_granted","mission.approval_denied","execution.verification_pending","execution.verification_completed"];let pending=null;const refresh=(event)=>{try{const payload=event?JSON.parse(event.data):null;if(event)consoleOnLiveEvent(event.type||"unknown",payload?.payload||payload);}catch{}clearTimeout(pending);pending=setTimeout(()=>{refreshApprovalCount();if(["missions","mission","overview","approvals","evidence","trace","ecosystem","recovery"].includes(currentRoute))render(location.hash.split("/")[1]).catch(()=>{});},150);};liveTypes.forEach(type=>source.addEventListener(type,refresh));}
`;
}
