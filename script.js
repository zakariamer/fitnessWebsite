// Single-file frontend logic: registration/login, profile, recommendations, calorie tracker, photo upload
async function api(path, method="GET", body=null) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const resp = await fetch(path, opts);
  const j = await resp.json();
  if (!resp.ok) throw j;
  return j;
}

// UI helpers
const el = id => document.getElementById(id);
const show = (id) => el(id).classList.remove("hidden");
const hide = (id) => el(id).classList.add("hidden");

document.addEventListener("DOMContentLoaded", init);

function init(){
  // tab switch
  el("show-login").onclick = () => { el("show-login").classList.add("active"); el("show-register").classList.remove("active"); show("login-form"); hide("register-form"); };
  el("show-register").onclick = () => { el("show-register").classList.add("active"); el("show-login").classList.remove("active"); show("register-form"); hide("login-form"); };

  el("login-btn").onclick = doLogin;
  el("register-btn").onclick = doRegister;
  el("logout-btn").onclick = doLogout;
  el("refresh-recs").onclick = loadRecs;
  el("cal-manual-form").onsubmit = addManualCal;
  el("upload-photo").onclick = uploadPhoto;

  checkSession();
}

async function checkSession(){
  // Try to fetch profile
  try {
    const res = await api("/api/profile");
    if (res.ok) showApp(res.user);
  } catch (err) {
    show("auth-card");
    hide("app-panel");
  }
}

function showApp(user){
  hide("auth-card");
  show("app-panel");
  el("welcome").innerText = `Welcome, ${user.username}`;
  el("profile-summary").innerText = `Age: ${user.age || "-"} • BMI: ${user.bmi || "-"} • Goal: ${user.goal || "-"}`;
  loadRecs();
  loadCals();
}

async function doRegister(){
  const body = {
    username: el("reg-username").value.trim(),
    password: el("reg-password").value,
    age: el("reg-age").value,
    height_cm: el("reg-height").value,
    weight_kg: el("reg-weight").value,
    goal: el("reg-goal").value
  };
  try {
    await api("/register", "POST", body);
    // Redirect to home page after successful registration
    window.location.href = "/home";
  } catch (e) {
    alert(e.error || "Registration failed");
  }
}

async function doLogin(){
  try {
    await api("/login", "POST", { username: el("login-username").value, password: el("login-password").value });
    // Redirect to home page after successful login
    window.location.href = "/home";
  } catch (e) {
    alert(e.error || "Login failed");
  }
}

async function doLogout(){
  try {
    await api("/logout", "POST");
    window.location.href = "/";
  } catch (e) {
    window.location.href = "/";
  }
}

async function loadRecs(){
  try {
    const r = await api("/api/recommendations");
    const list = el("recommendations");
    list.innerHTML = "";
    r.recs.forEach(s => {
      const li = document.createElement("li");
      li.textContent = s;
      list.appendChild(li);
    });
  } catch (err) {
    console.error(err);
  }
}

async function addManualCal(ev){
  ev.preventDefault();
  const desc = el("cal-desc").value || "Manual";
  const calories = el("cal-num").value || 0;
  try {
    await api("/api/calories", "POST", { description: desc, calories: Number(calories) });
    el("cal-desc").value = ""; el("cal-num").value = "";
    loadCals();
  } catch (err) {
    alert("Could not add entry");
  }
}

async function loadCals(){
  try {
    const r = await api("/api/calories");
    const list = el("cal-items");
    list.innerHTML = "";
    r.items.forEach(it => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${it.description} — ${it.calories} kcal</span><button data-id="${it.id}">Delete</button>`;
      li.querySelector("button").onclick = async () => {
        await api("/api/calories", "DELETE", { id: it.id });
        loadCals();
      };
      list.appendChild(li);
    });
  } catch (err) {
    console.error(err);
  }
}

async function uploadPhoto(){
  const input = el("photo-input");
  if (!input.files.length) { alert("Select a photo first"); return; }
  const file = input.files[0];
  const fd = new FormData();
  fd.append("photo", file);
  const resEl = el("photo-result");
  resEl.innerText = "Uploading & analyzing...";
  try {
    const resp = await fetch("/api/upload_photo", { method: "POST", body: fd });
    const j = await resp.json();
    if (!resp.ok) throw j;
    const result = j.result;
    // display
    let html = `<strong>Estimated total calories: ${result.total_calories} kcal</strong><ul>`;
    result.items.forEach(it => {
      html += `<li>${it.name} — ${it.calories} kcal (${(it.confidence*100).toFixed(0)}% conf, ${it.serving_size})</li>`;
    });
    html += `</ul><button id="save-photo-cal">Save as entry</button>`;
    resEl.innerHTML = html;
    document.getElementById("save-photo-cal").onclick = async () => {
      await api("/api/calories", "POST", { description: "Photo estimate", calories: Number(result.total_calories) });
      alert("Saved to tracker");
      loadCals();
    };
  } catch (e) {
    console.error(e);
    resEl.innerText = "Error analyzing image";
  }
}
