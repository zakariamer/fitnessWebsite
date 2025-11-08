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
    const emptyMsg = el("cal-empty");
    const totalEl = el("cal-total");
    
    list.innerHTML = "";
    
    if (!r.items || r.items.length === 0) {
      if (emptyMsg) emptyMsg.style.display = "block";
      if (totalEl) totalEl.textContent = "0 kcal";
      return;
    }
    
    if (emptyMsg) emptyMsg.style.display = "none";
    
    // Calculate today's total
    const today = new Date().toISOString().split('T')[0];
    let todayTotal = 0;
    let allTotal = 0;
    
    // Sort by timestamp (newest first)
    const sortedItems = r.items.sort((a, b) => {
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    
    sortedItems.forEach(it => {
      allTotal += it.calories;
      const itemDate = it.timestamp.split('T')[0];
      if (itemDate === today) {
        todayTotal += it.calories;
      }
      
      // Format timestamp
      const date = new Date(it.timestamp);
      const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const isToday = itemDate === today;
      
      const li = document.createElement("li");
      li.style.cssText = "margin-bottom: 12px; padding: 15px; background: white; border-radius: 12px; border-left: 4px solid var(--accent); box-shadow: 0 2px 8px rgba(0,0,0,0.08); display: flex; justify-content: space-between; align-items: center; gap: 15px;";
      
      li.innerHTML = `
        <div style="flex: 1;">
          <div style="font-weight: 600; font-size: 1.1rem; color: var(--text); margin-bottom: 5px;">
            ${it.description || 'Unnamed entry'}
          </div>
          <div style="display: flex; gap: 15px; align-items: center; flex-wrap: wrap;">
            <span style="font-size: 1.3rem; font-weight: 700; color: var(--accent);">${it.calories} kcal</span>
            <span style="color: var(--text-light); font-size: 0.9rem;">
              ${isToday ? '🕐 ' + timeStr : '📅 ' + dateStr + ' ' + timeStr}
            </span>
          </div>
        </div>
        <button data-id="${it.id}" style="padding: 8px 16px; font-size: 0.9rem; background: linear-gradient(135deg, var(--danger) 0%, #dc2626 100%); box-shadow: 0 2px 10px rgba(239, 68, 68, 0.3); white-space: nowrap;">
          🗑️ Delete
        </button>
      `;
      
      li.querySelector("button").onclick = async () => {
        if (confirm(`Delete "${it.description}" (${it.calories} kcal)?`)) {
          try {
            await api("/api/calories", "DELETE", { id: it.id });
            loadCals();
          } catch (err) {
            alert("Error deleting entry");
          }
        }
      };
      
      list.appendChild(li);
    });
    
    // Update total display
    if (totalEl) {
      totalEl.textContent = `${todayTotal} kcal`;
      if (todayTotal > 0) {
        totalEl.style.color = "var(--accent)";
      }
    }
  } catch (err) {
    console.error(err);
    const list = el("cal-items");
    if (list) {
      list.innerHTML = '<li style="padding: 15px; color: var(--danger);">Error loading entries. Please refresh.</li>';
    }
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
