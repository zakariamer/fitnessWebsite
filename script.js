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
  // tab switch (only if elements exist)
  const showLogin = el("show-login");
  const showRegister = el("show-register");
  if (showLogin && showRegister) {
    showLogin.onclick = () => { 
      el("show-login").classList.add("active"); 
      el("show-register").classList.remove("active"); 
      show("login-form"); 
      hide("register-form"); 
    };
    showRegister.onclick = () => { 
      el("show-register").classList.add("active"); 
      el("show-login").classList.remove("active"); 
      show("register-form"); 
      hide("login-form"); 
    };
  }

  // Set up handlers only if elements exist
  const loginBtn = el("login-btn");
  if (loginBtn) loginBtn.onclick = doLogin;
  
  const registerBtn = el("register-btn");
  if (registerBtn) registerBtn.onclick = doRegister;
  
  const logoutBtn = el("logout-btn");
  if (logoutBtn) logoutBtn.onclick = doLogout;
  
  const refreshRecs = el("refresh-recs");
  if (refreshRecs) refreshRecs.onclick = loadRecs;
  
  const calForm = el("cal-manual-form");
  if (calForm) calForm.onsubmit = addManualCal;
  
  const uploadPhotoBtn = el("upload-photo");
  if (uploadPhotoBtn) uploadPhotoBtn.onclick = uploadPhoto;
  
  // Show preview when file is selected
  const photoInput = el("photo-input");
  if (photoInput) {
    photoInput.onchange = function() {
      const file = this.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
          const preview = el("photo-preview");
          if (preview) {
            preview.innerHTML = `
              <div style="text-align: center;">
                <img src="${e.target.result}" alt="Selected food" style="max-width: 100%; max-height: 300px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);" />
                <p style="margin-top: 10px; color: var(--text-light); font-size: 0.9rem;">📷 ${file.name}</p>
              </div>
            `;
          }
        };
        reader.readAsDataURL(file);
      }
    };
  }

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
  resEl.innerHTML = '<div style="text-align: center; padding: 20px;"><div style="display: inline-block; padding: 15px; background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%); border-radius: 12px;">📤 Uploading & analyzing...</div></div>';
  
  try {
    const resp = await fetch("/api/upload_photo", { method: "POST", body: fd });
    const j = await resp.json();
    if (!resp.ok) throw j;
    const result = j.result;
    
    // Display the uploaded image and results
    let html = `<div style="text-align: center; margin-bottom: 20px;">`;
    if (result.image_url) {
      html += `<img src="${result.image_url}" alt="Uploaded food" style="max-width: 100%; max-height: 400px; border-radius: 15px; box-shadow: 0 8px 25px rgba(0,0,0,0.15); margin-bottom: 20px;" />`;
    }
    html += `</div>`;
    
    html += `<div style="background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%); padding: 20px; border-radius: 15px; margin-bottom: 15px;">`;
    html += `<h3 style="margin: 0 0 15px 0; color: var(--accent); font-size: 1.5rem;">📊 Calorie Estimate</h3>`;
    html += `<div style="font-size: 2rem; font-weight: 700; color: var(--accent); margin-bottom: 15px;">${result.total_calories} kcal</div>`;
    
    if (result.items && result.items.length > 0) {
      html += `<div style="margin-top: 15px;"><strong>Detected items:</strong><ul style="margin-top: 10px; padding-left: 20px;">`;
      result.items.forEach(it => {
        const confPercent = (it.confidence * 100).toFixed(0);
        html += `<li style="margin-bottom: 8px; padding: 8px; background: white; border-radius: 8px; border-left: 4px solid var(--accent);">
          <strong>${it.name}</strong> — ${it.calories} kcal 
          <span style="color: var(--text-light); font-size: 0.9rem;">(${confPercent}% confidence, ${it.serving_size})</span>
        </li>`;
      });
      html += `</ul></div>`;
    }
    html += `</div>`;
    
    html += `<button id="save-photo-cal" style="width: 100%; padding: 15px; font-size: 1.1rem; margin-top: 10px;">💾 Save ${result.total_calories} kcal to Tracker</button>`;
    
    resEl.innerHTML = html;
    document.getElementById("save-photo-cal").onclick = async () => {
      try {
        await api("/api/calories", "POST", { description: "Photo estimate", calories: Number(result.total_calories) });
        alert("✅ Saved to tracker!");
        loadCals();
        // Clear the form
        input.value = "";
        const preview = el("photo-preview");
        if (preview) preview.innerHTML = "";
      } catch (err) {
        alert("Error saving to tracker");
      }
    };
  } catch (e) {
    console.error(e);
    resEl.innerHTML = `<div style="padding: 20px; background: rgba(239, 68, 68, 0.1); border-radius: 12px; color: var(--danger); text-align: center;">❌ Error analyzing image: ${e.error || "Unknown error"}</div>`;
  }
}
