/**
 * All styles for the extension UI.
 * Scoped under .ytms-* to avoid collisions with YouTube Music's own CSS.
 * Injected once into <head> via a <style> tag.
 */
export const EXTENSION_STYLES = `
/* ----- Button ----- */

.ytms-btn-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  clear: both;
  margin-top: 24px; 
  margin-bottom: 10px;
  box-sizing: border-box;
}

.ytms-shuffle-btn,
.ytms-restore-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 36px;
  padding: 0 24px;
  border: none;
  border-radius: 18px;
  cursor: pointer;
  font-family: "YouTube Sans", "Roboto", Roboto, Arial, sans-serif;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: .01em;
  white-space: nowrap;
  outline: none;
  transition: background 0.18s, opacity 0.18s, transform 0.1s;
  -webkit-font-smoothing: antialiased;
}

.ytms-shuffle-btn {
  background: #f03;
  color: #fff;
}
.ytms-shuffle-btn:hover  { background: #d4002a; }
.ytms-shuffle-btn:active { transform: scale(0.96); }
.ytms-shuffle-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
}

.ytms-restore-btn {
  background: transparent;
  color: rgba(255,255,255,0.75);
  border: 1.5px solid rgba(255,255,255,0.25);
}
.ytms-restore-btn:hover  { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.5); }
.ytms-restore-btn:active { transform: scale(0.96); }

.ytms-btn-icon {
  width: 16px;
  height: 16px;
  fill: currentColor;
  flex-shrink: 0;
  pointer-events: none;
}

.ytms-spinning {
  animation: ytms-spin 0.9s linear infinite;
}

@keyframes ytms-spin {
  to { transform: rotate(360deg); }
}

/* ----- Modal overlay ----- */

.ytms-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2147483647;
  animation: ytms-fade-in 0.18s ease;
  backdrop-filter: blur(2px);
}

@keyframes ytms-fade-in  { from { opacity: 0 } to { opacity: 1 } }
@keyframes ytms-fade-out { from { opacity: 1 } to { opacity: 0 } }

.ytms-modal {
  background: #1f1f1f;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  padding: 28px;
  width: 420px;
  max-width: calc(100vw - 40px);
  box-shadow: 0 32px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04);
  animation: ytms-slide-up 0.28s cubic-bezier(0.34,1.4,0.64,1);
  font-family: "YouTube Sans", "Roboto", Roboto, Arial, sans-serif;
  color: #fff;
}

@keyframes ytms-slide-up {
  from { transform: translateY(18px); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}

/* ----- Modal header ----- */

.ytms-modal-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 22px;
}

.ytms-modal-icon-wrap {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: linear-gradient(135deg, #f03 0%, #aa0022 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ytms-modal-icon-wrap svg {
  width: 20px;
  height: 20px;
  fill: #fff;
}

.ytms-modal-title {
  font-size: 17px;
  font-weight: 700;
  line-height: 1.2;
}

.ytms-modal-sub {
  font-size: 12px;
  color: rgba(255,255,255,0.45);
  margin-top: 2px;
}

/* ── Progress area ────────────────────────────────────────────────────────── */

.ytms-status {
  font-size: 14px;
  color: rgba(255,255,255,0.85);
  min-height: 20px;
  margin-bottom: 14px;
  line-height: 1.45;
}

.ytms-bar-track {
  background: rgba(255,255,255,0.1);
  border-radius: 3px;
  height: 3px;
  overflow: hidden;
  margin-bottom: 7px;
}

.ytms-bar-fill {
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, #f03, #ff6b6b);
  transition: width 0.35s ease;
}

.ytms-bar-fill.ytms-indeterminate {
  width: 38% !important;
  animation: ytms-indeterminate 1.4s ease-in-out infinite;
}

@keyframes ytms-indeterminate {
  0%   { transform: translateX(-120%); }
  100% { transform: translateX(420%); }
}

.ytms-progress-label {
  font-size: 11px;
  color: rgba(255,255,255,0.38);
  text-align: right;
  margin-bottom: 22px;
  min-height: 15px;
}

/* ----- Modal footer ----- */

.ytms-modal-foot {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 10px;
}

.ytms-btn-ghost {
  background: transparent;
  border: 1.5px solid rgba(255,255,255,0.2);
  color: rgba(255,255,255,0.65);
  padding: 8px 18px;
  border-radius: 20px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.ytms-btn-ghost:hover { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.4); }
.ytms-btn-ghost:disabled { opacity: 0.45; cursor: not-allowed; }

.ytms-btn-solid {
  background: #f03;
  border: none;
  color: #fff;
  padding: 8px 20px;
  border-radius: 20px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.ytms-btn-solid:hover { background: #d4002a; }

.ytms-btn-danger-ghost {
  background: transparent;
  border: 1.5px solid rgba(255,68,68,0.55);
  color: #ff8080;
  padding: 8px 18px;
  border-radius: 20px;
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}
.ytms-btn-danger-ghost:hover { background: rgba(255,68,68,0.1); }

/* ----- Result screens ----- */

.ytms-result {
  text-align: center;
  padding: 8px 0 4px;
}

.ytms-result-icon {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 18px;
  animation: ytms-pop 0.35s cubic-bezier(0.34,1.56,0.64,1);
}

@keyframes ytms-pop {
  from { transform: scale(0.2); opacity: 0; }
  to   { transform: scale(1);   opacity: 1; }
}

.ytms-result-icon.ytms-success { background: #1db954; }
.ytms-result-icon.ytms-error   { background: #e5533c; }

.ytms-result-icon svg {
  width: 26px;
  height: 26px;
  fill: #fff;
}

.ytms-result-title {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 10px;
}

.ytms-result-msg {
  font-size: 13.5px;
  color: rgba(255,255,255,0.6);
  line-height: 1.6;
  white-space: pre-wrap;
}

/* ----- Toast notification ----- */

.ytms-toast {
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%) translateY(0);
  background: #2a2a2a;
  color: #fff;
  padding: 12px 24px;
  border-radius: 10px;
  font-family: "YouTube Sans","Roboto",Roboto,Arial,sans-serif;
  font-size: 13.5px;
  font-weight: 500;
  z-index: 2147483646;
  box-shadow: 0 6px 24px rgba(0,0,0,0.5);
  max-width: 440px;
  text-align: center;
  animation: ytms-toast-in 0.25s cubic-bezier(0.34,1.4,0.64,1);
  pointer-events: none;
}

.ytms-toast.ytms-toast-success { background: #1a5c33; }
.ytms-toast.ytms-toast-error   { background: #7a1515; }

.ytms-modal-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 22px;
}

.ytms-modal-icon-wrap {
  width: 40px;        
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: transparent;   
  border-radius: 0;         
  overflow: hidden;
}

.ytms-modal-logo {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.ytms-modal-icon-wrap svg {
  width: 20px;
  height: 20px;
  fill: #fff;
}

@keyframes ytms-toast-in {
  from { transform: translateX(-50%) translateY(16px); opacity: 0; }
  to   { transform: translateX(-50%) translateY(0);    opacity: 1; }
}
@keyframes ytms-toast-out {
  from { transform: translateX(-50%) translateY(0);    opacity: 1; }
  to   { transform: translateX(-50%) translateY(16px); opacity: 0; }
}
`;
