const API = window.STAFF_TRACKER_API;
let me = null;
let state = { staff: [], roles: [], permissions: [], grants: [], attendance: [], summary: [] };
const $ = sel => document.querySelector(sel);
const view = $('#view');

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts
  });
  const txt = await res.text();
  let data = txt ? JSON.parse(txt) : {};
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}
function can(p) { return me?.isOwner || me?.permissions?.includes(p); }
function escapeHtml(v='') { return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function today() { return new Date().toISOString().slice(0,10); }
function sundayStart(date = new Date()) { const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0,10); }
function roleOptions(selected='') { return state.roles.map(r => `<option ${r.role_name===selected?'selected':''}>${escapeHtml(r.role_name)}</option>`).join(''); }
function staffOptions(selected='') { return state.staff.map(s => `<option value="${s.discord_id}" ${s.discord_id===selected?'selected':''}>${escapeHtml(s.display_name)} (${s.discord_id})</option>`).join(''); }
function notify(msg, error=false) { view.insertAdjacentHTML('afterbegin', `<div class="card ${error?'error':'notice'}">${escapeHtml(msg)}</div>`); }

async function init() {
  $('#loginBtn').onclick = () => location.href = API + '/auth/login';
  try {
    me = await api('/api/me');
    $('#loggedOut').classList.add('hidden');
    $('#app').classList.remove('hidden');
    renderAuth();
    renderTabs();
    await loadCore();
    showDashboard();
  } catch {
    $('#loggedOut').classList.remove('hidden');
    $('#app').classList.add('hidden');
    $('#authBox').innerHTML = '';
  }
}
function renderAuth() {
  $('#authBox').innerHTML = `<div class="card"><strong>${escapeHtml(me.user.display_name)}</strong><br><span class="muted">${escapeHtml(me.user.discord_id)}</span><br><button class="secondary" id="logoutBtn">Logout</button></div>`;
  $('#logoutBtn').onclick = async () => { await api('/auth/logout'); location.reload(); };
}
function renderTabs(active='dashboard') {
  const tabs = [
    ['dashboard','Dashboard', true],
    ['attendance','Attendance', can('ATTENDANCE_VIEW_ALL') || can('ATTENDANCE_VIEW_SELF')],
    ['staff','Staff', can('STAFF_VIEW_ALL') || can('STAFF_VIEW_SELF')],
    ['roles','Roles & Permissions', can('PERMISSIONS_MANAGE') || can('ROLES_MANAGE')],
    ['audit','Audit Log', can('AUDIT_VIEW')]
  ].filter(t => t[2]);
  $('#tabs').innerHTML = tabs.map(([id,label]) => `<button data-tab="${id}" class="${id===active?'active':''}">${label}</button>`).join('');
  $('#tabs').onclick = e => {
    if (!e.target.dataset.tab) return;
    renderTabs(e.target.dataset.tab);
    ({ dashboard: showDashboard, attendance: showAttendance, staff: showStaff, roles: showRoles, audit: showAudit })[e.target.dataset.tab]();
  };
}
async function loadCore() {
  const promises = [];
  if (can('STAFF_VIEW_ALL') || can('STAFF_VIEW_SELF')) promises.push(api('/api/staff').then(d => state.staff = d.staff));
  promises.push(api('/api/roles').then(d => { state.roles=d.roles; state.permissions=d.permissions; state.grants=d.grants; }).catch(()=>{}));
  await Promise.all(promises);
}

async function showDashboard() {
  if (can('SUMMARY_VIEW')) {
    const d = await api('/api/summary'); state.summary = d.summary;
    view.innerHTML = `<div class="card"><h2>This week</h2><p class="muted">Week starts Sunday. Missing records through today count as absences.</p>${summaryTable()}</div>`;
  } else {
    view.innerHTML = `<div class="card"><h2>Welcome</h2><p>You are logged in. Use Attendance to mark your attendance.</p></div>`;
  }
}
function summaryTable() {
  return `<table><thead><tr><th>Staff</th><th>Roles</th><th>Present</th><th>Excused</th><th>Absent</th><th>Credited</th></tr></thead><tbody>${state.summary.map(s => `<tr><td>${escapeHtml(s.display_name)}<br><span class="muted">${s.discord_id}</span></td><td>${badges([s.primary_roles, s.additional_roles].filter(Boolean).join(','))}</td><td>${s.present}</td><td>${s.excused}</td><td>${s.total_absent}</td><td>${s.credited_days}</td></tr>`).join('')}</tbody></table>`;
}
function badges(csv='') { return csv.split(',').filter(Boolean).map(r => `<span class="badge">${escapeHtml(r)}</span>`).join(''); }

async function showAttendance() {
  const start = sundayStart();
  const data = await api(`/api/attendance?start=${start}&end=${today()}`); state.attendance = data.attendance;
  const canAny = can('ATTENDANCE_MARK_ANY');
  view.innerHTML = `<div class="card"><h2>Mark attendance</h2><div class="grid">
    <div class="field"><label>Staff member</label>${canAny ? `<select id="attDiscord">${staffOptions(me.user.discord_id)}</select>` : `<input id="attDiscord" value="${me.user.discord_id}" disabled>`}</div>
    <div class="field"><label>Date</label><input type="date" id="attDate" value="${today()}"></div>
    <div class="field"><label>Status</label><select id="attStatus"><option>Present</option><option>Excused</option><option>Absent</option></select></div>
    <div class="field"><label>Note</label><input id="attNote" placeholder="Optional"></div>
  </div><p><button id="saveAttendance">Save attendance</button></p></div>
  <div class="card"><h2>Current week records</h2>${attendanceTable()}</div>`;
  $('#saveAttendance').onclick = async () => {
    try { await api('/api/attendance', { method:'POST', body: JSON.stringify({ discord_id: $('#attDiscord').value, date: $('#attDate').value, status: $('#attStatus').value, note: $('#attNote').value }) }); await showAttendance(); }
    catch(e){ notify(e.message, true); }
  };
}
function attendanceTable() {
  return `<table><thead><tr><th>Date</th><th>Staff</th><th>Status</th><th>Note</th><th>Marked by</th></tr></thead><tbody>${state.attendance.map(a => `<tr><td>${a.date}</td><td>${escapeHtml(a.display_name)}<br><span class="muted">${a.discord_id}</span></td><td><span class="badge ${a.status==='Present'?'good':a.status==='Excused'?'warn':'bad'}">${a.status}</span></td><td>${escapeHtml(a.note||'')}</td><td>${a.marked_by}</td></tr>`).join('')}</tbody></table>`;
}

async function showStaff() {
  await loadCore();
  view.innerHTML = `<div class="card"><h2>Staff</h2>${can('STAFF_MANAGE') ? staffForm() : ''}${staffTable()}</div>`;
  if (can('STAFF_MANAGE')) $('#saveStaff').onclick = saveStaff;
}
function staffForm() {
  return `<h3>Add/update staff</h3><div class="grid">
    <div class="field"><label>Discord ID</label><input id="staffId" placeholder="123456789012345678"></div>
    <div class="field"><label>Display name</label><input id="staffDisplay"></div>
    <div class="field"><label>Username</label><input id="staffUser"></div>
    <div class="field"><label>Status</label><select id="staffStatus"><option>Fine</option><option>Promotion Candidate</option><option>Demotion Risk</option><option>Inactive</option></select></div>
    <div class="field"><label>Notes</label><input id="staffNotes"></div>
  </div><p><button id="saveStaff">Save staff</button></p>`;
}
function staffTable() {
  return `<table><thead><tr><th>Name</th><th>Status</th><th>Primary roles</th><th>Additional roles</th><th>Actions</th></tr></thead><tbody>${state.staff.map(s => `<tr><td>${escapeHtml(s.display_name)}<br><span class="muted">${escapeHtml(s.username||'')} ${s.discord_id}</span></td><td>${escapeHtml(s.status)}</td><td>${badges(s.primary_roles)}</td><td>${badges(s.additional_roles)}</td><td>${can('ROLES_MANAGE')?roleAssignMini(s):''}</td></tr>`).join('')}</tbody></table>`;
}
function roleAssignMini(s) {
  return `<div class="row-actions"><select id="role-${s.discord_id}">${roleOptions()}</select><select id="primary-${s.discord_id}"><option value="0">Additional</option><option value="1">Primary</option></select><button onclick="assignRole('${s.discord_id}')">Assign</button></div>`;
}
async function saveStaff() {
  try {
    await api('/api/staff', { method:'POST', body: JSON.stringify({ discord_id: $('#staffId').value, display_name: $('#staffDisplay').value, username: $('#staffUser').value, status: $('#staffStatus').value, notes: $('#staffNotes').value }) });
    await showStaff();
  } catch(e){ notify(e.message, true); }
}
window.assignRole = async (id) => {
  try { await api('/api/staff-roles', { method:'POST', body: JSON.stringify({ discord_id:id, role_name: $(`#role-${id}`).value, is_primary: $(`#primary-${id}`).value === '1' }) }); await showStaff(); }
  catch(e){ notify(e.message, true); }
};

async function showRoles() {
  await loadCore();
  const selected = state.roles[0]?.role_name || '';
  view.innerHTML = `<div class="card"><h2>Roles & permissions</h2><p class="muted">Create as many roles as you want, then pick exactly what each role can see or do.</p>
    ${can('PERMISSIONS_MANAGE') ? roleEditor(selected) : '<p>You can assign roles but cannot edit permission rules.</p>'}</div>`;
  if (can('PERMISSIONS_MANAGE')) bindRoleEditor(selected);
}
function roleEditor(selected) {
  return `<div class="grid"><div class="field"><label>Choose role</label><select id="editRole">${roleOptions(selected)}</select></div><div class="field"><label>Or new role name</label><input id="newRole" placeholder="Trial Moderator"></div><div class="field"><label>Description</label><input id="roleDesc"></div><div class="field"><label>Color</label><input id="roleColor" value="#64748b"></div></div><h3>Permissions</h3><div class="checkbox-grid">${state.permissions.map(p => `<label class="checkbox"><input type="checkbox" value="${p.permission_key}"><span><strong>${escapeHtml(p.label)}</strong><br><span class="muted">${escapeHtml(p.description)}</span></span></label>`).join('')}</div><p><button id="saveRole">Save role permissions</button></p>`;
}
function bindRoleEditor(selected) {
  function loadRole(name) {
    const role = state.roles.find(r => r.role_name === name) || {};
    $('#roleDesc').value = role.description || '';
    $('#roleColor').value = role.color || '#64748b';
    const granted = new Set(state.grants.filter(g => g.role_name === name).map(g => g.permission_key));
    document.querySelectorAll('.checkbox input').forEach(cb => cb.checked = granted.has(cb.value));
  }
  $('#editRole').onchange = e => loadRole(e.target.value);
  loadRole(selected);
  $('#saveRole').onclick = async () => {
    const role_name = $('#newRole').value.trim() || $('#editRole').value;
    const permissions = [...document.querySelectorAll('.checkbox input:checked')].map(cb => cb.value);
    try { await api('/api/roles', { method:'POST', body: JSON.stringify({ role_name, description: $('#roleDesc').value, color: $('#roleColor').value, permissions }) }); await showRoles(); }
    catch(e){ notify(e.message, true); }
  };
}

async function showAudit() {
  const d = await api('/api/audit');
  view.innerHTML = `<div class="card"><h2>Audit log</h2><table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody>${d.audit.map(a => `<tr><td>${a.created_at}</td><td>${a.actor_discord_id}</td><td>${a.action}</td><td>${a.target_discord_id||''}</td><td>${escapeHtml(a.details||'')}</td></tr>`).join('')}</tbody></table></div>`;
}

init();
