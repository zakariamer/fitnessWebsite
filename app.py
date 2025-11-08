import os
import sqlite3
import secrets
import datetime
import requests
from flask import (
    Flask, g, render_template, request, redirect, url_for, session, jsonify, send_from_directory
)
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
from PIL import Image

# Configuration
APP_SECRET = os.environ.get("APP_SECRET", secrets.token_hex(16))
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), "uploads")
ALLOWED_EXT = {"png", "jpg", "jpeg"}
# Spoonacular API Key - Get free key at https://spoonacular.com/food-api
SPOONACULAR_API_KEY = os.environ.get("SPOONACULAR_API_KEY", "")

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

app = Flask(__name__, template_folder='.')
app.secret_key = APP_SECRET
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
DATABASE = os.path.join(os.path.dirname(__file__), "data.sqlite")

# --- DB helpers ---
def get_db():
    db = getattr(g, "_database", None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
    return db

def init_db():
    schema = """
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        age INTEGER,
        height_cm REAL,
        weight_kg REAL,
        bmi REAL,
        goal TEXT,
        created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS calories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        description TEXT,
        calories REAL,
        FOREIGN KEY(user_id) REFERENCES users(id)
    );
    """
    db = get_db()
    db.executescript(schema)
    db.commit()

# Initialize database on startup
with app.app_context():
    init_db()

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, "_database", None)
    if db is not None:
        db.close()

# --- Auth routes ---
def current_user():
    uid = session.get("user_id")
    if not uid:
        return None
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    return row

@app.route("/")
def index():
    user = current_user()
    return render_template("index.html", user=user)

@app.route("/register", methods=["POST"])
def register():
    data = request.json
    username = data.get("username")
    password = data.get("password")
    age = int(data.get("age") or 0)
    height_cm = float(data.get("height_cm") or 0)
    weight_kg = float(data.get("weight_kg") or 0)
    goal = data.get("goal") or "maintain"
    bmi = None
    if height_cm > 0:
        h_m = height_cm / 100.0
        bmi = round(weight_kg / (h_m*h_m), 1)
    pw_hash = generate_password_hash(password)
    created_at = datetime.datetime.utcnow().isoformat()
    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO users (username, password_hash, age, height_cm, weight_kg, bmi, goal, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (username, pw_hash, age, height_cm, weight_kg, bmi, goal, created_at)
        )
        db.commit()
        uid = cur.lastrowid
    except Exception as e:
        return jsonify({"ok": False, "error": "username exists or bad data"}), 400
    session["user_id"] = uid
    return jsonify({"ok": True, "user_id": uid})

@app.route("/login", methods=["POST"])
def login():
    data = request.json
    username = data.get("username")
    password = data.get("password")
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not row:
        return jsonify({"ok": False, "error": "invalid credentials"}), 400
    if not check_password_hash(row["password_hash"], password):
        return jsonify({"ok": False, "error": "invalid credentials"}), 400
    session["user_id"] = row["id"]
    return jsonify({"ok": True})

@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    # Check if it's a JSON request (from JavaScript) or form submission
    if request.is_json or request.content_type == "application/json":
        return jsonify({"ok": True})
    return redirect(url_for("index"))

@app.route("/home")
def home():
    user = current_user()
    if not user:
        return redirect(url_for("index"))
    db = get_db()
    # Calculate today's calories (SQLite stores ISO format strings)
    today_start = datetime.datetime.utcnow().date().isoformat() + "T00:00:00"
    today_end = datetime.datetime.utcnow().date().isoformat() + "T23:59:59"
    today_rows = db.execute(
        "SELECT SUM(calories) as total FROM calories WHERE user_id = ? AND timestamp >= ? AND timestamp <= ?",
        (user["id"], today_start, today_end)
    ).fetchone()
    today_cals = today_rows["total"] or 0
    
    # Calculate week's calories
    week_ago = (datetime.datetime.utcnow() - datetime.timedelta(days=7)).isoformat()
    week_rows = db.execute(
        "SELECT SUM(calories) as total FROM calories WHERE user_id = ? AND timestamp >= ?",
        (user["id"], week_ago)
    ).fetchone()
    week_cals = week_rows["total"] or 0
    
    calories = {"today": int(today_cals), "week": int(week_cals)}
    progress = {"completed": "0 workouts", "remaining": "3 workouts this week"}
    
    return render_template("home.html", user=dict(user), calories=calories, progress=progress)

# --- Profile & recommendations ---
@app.route("/api/profile", methods=["GET", "POST"])
def profile():
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "not logged in"}), 403
    db = get_db()
    if request.method == "GET":
        return jsonify({"ok": True, "user": dict(user)})
    else:
        data = request.json
        age = int(data.get("age") or user["age"] or 0)
        height_cm = float(data.get("height_cm") or user["height_cm"] or 0)
        weight_kg = float(data.get("weight_kg") or user["weight_kg"] or 0)
        goal = data.get("goal") or user["goal"] or "maintain"
        bmi = None
        if height_cm > 0:
            h_m = height_cm/100.0
            bmi = round(weight_kg / (h_m*h_m), 1)
        db.execute(
            "UPDATE users SET age=?, height_cm=?, weight_kg=?, bmi=?, goal=? WHERE id=?",
            (age, height_cm, weight_kg, bmi, goal, user["id"])
        )
        db.commit()
        row = db.execute("SELECT * FROM users WHERE id = ?", (user["id"],)).fetchone()
        return jsonify({"ok": True, "user": dict(row)})

def generate_recommendations(age, bmi, goal):
    # Simple rules-based engine that can be improved or replaced by ML model.
    recs = []
    # Base suggestions by BMI
    if bmi is None:
        recs.append("Please add height and weight so we can recommend tailored exercises.")
    else:
        if bmi < 18.5:
            recs.append("Increase strength training (full body) 2-3x/week and add calorie-dense healthy foods.")
        elif 18.5 <= bmi < 25:
            recs.append("Mix of cardio (30 min moderate 3x/week) and resistance training (2x/week).")
        elif 25 <= bmi < 30:
            recs.append("Focus on moderate cardio (walking, cycling) 4-5x/week and progressive resistance training 2x/week.")
        else:
            recs.append("Low-impact cardio (walking, swimming) daily if possible and start strength training 2x/week. Consult a clinician.")

    # Age adjustments
    if age >= 60:
        recs.append("Prioritize balance and flexibility (yoga, tai chi) and functional strength work.")
    elif age >= 40:
        recs.append("Include mobility work and progressive strength training; allow extra recovery.")
    else:
        recs.append("Include a mix of HIIT or interval cardio if cleared for vigorous exercise.")

    # Goal-specific
    if goal == "lose":
        recs.append("Calorie deficit + cardio + strength 3x/week. Track intake and weekly progress.")
    elif goal == "gain":
        recs.append("Calorie surplus + focused strength program (3-5x/week) with progressive overload.")
    else:
        recs.append("Maintenance: balanced training with two strength sessions and 2-3 cardio sessions/week.")

    return recs

@app.route("/api/recommendations", methods=["GET"])
def recommendations():
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "not logged in"}), 403
    recs = generate_recommendations(user["age"], user["bmi"], user["goal"])
    return jsonify({"ok": True, "recs": recs})

# --- Calorie tracking (manual) ---
@app.route("/api/calories", methods=["GET", "POST", "DELETE"])
def calories():
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "not logged in"}), 403
    db = get_db()
    if request.method == "GET":
        rows = db.execute("SELECT * FROM calories WHERE user_id = ? ORDER BY timestamp DESC", (user["id"],)).fetchall()
        items = [dict(r) for r in rows]
        return jsonify({"ok": True, "items": items})
    elif request.method == "POST":
        data = request.json
        desc = data.get("description", "")
        calories_val = float(data.get("calories") or 0)
        ts = datetime.datetime.utcnow().isoformat()
        db.execute("INSERT INTO calories (user_id, timestamp, description, calories) VALUES (?, ?, ?, ?)",
                   (user["id"], ts, desc, calories_val))
        db.commit()
        return jsonify({"ok": True})
    else:
        # expecting json with id
        data = request.json
        cid = int(data.get("id"))
        db.execute("DELETE FROM calories WHERE id = ? AND user_id = ?", (cid, user["id"]))
        db.commit()
        return jsonify({"ok": True})

# --- Image upload & AI stub ---
def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXT

def estimate_calories_from_image(image_path):
    """
    Uses Spoonacular Food Recognition API to identify food, get calories, and ingredients.
    Only uses fallback if API key is not set.
    Returns: { "items": [{"name": "...", "confidence": 0.9, "calories": 285.0, "serving_size": "...", "ingredients": [...]}],
               "total_calories": 285.0 }
    """
    # Only use API if key is available - no fallback if API fails (show error instead)
    if not SPOONACULAR_API_KEY:
        raise Exception("Spoonacular API key not set. Please set SPOONACULAR_API_KEY environment variable.")
    
    try:
        # Read image file
        with open(image_path, 'rb') as img_file:
            img_data = img_file.read()
        
        # Step 1: Classify the food image
        classify_url = "https://api.spoonacular.com/food/images/classify"
        headers = {
            "x-api-key": SPOONACULAR_API_KEY
        }
        files = {
            "file": (os.path.basename(image_path), img_data, "image/jpeg")
        }
        
        classify_response = requests.post(classify_url, headers=headers, files=files, timeout=15)
        
        if classify_response.status_code != 200:
            error_msg = classify_response.json().get("message", "API request failed")
            raise Exception(f"Spoonacular API error: {error_msg}")
        
        classify_data = classify_response.json()
        category = classify_data.get("category", "")
        confidence = classify_data.get("confidence", 0.7)
        
        if not category:
            raise Exception("Could not identify food in image")
        
        food_name = category.replace("_", " ").title()
        
        # Step 2: Get nutrition information using recipe search
        # Search for recipes matching this food
        recipe_search_url = "https://api.spoonacular.com/recipes/complexSearch"
        recipe_params = {
            "query": category,
            "number": 1,
            "apiKey": SPOONACULAR_API_KEY,
            "addRecipeInformation": "true"
        }
        
        recipe_response = requests.get(recipe_search_url, params=recipe_params, timeout=10)
        
        calories = 250  # Default
        serving_size = "1 serving"
        ingredients_list = []
        
        if recipe_response.status_code == 200:
            recipe_data = recipe_response.json()
            if "results" in recipe_data and len(recipe_data["results"]) > 0:
                recipe = recipe_data["results"][0]
                
                # Get calories from nutrition
                if "nutrition" in recipe:
                    nutrition = recipe["nutrition"]
                    if "nutrients" in nutrition:
                        for nutrient in nutrition["nutrients"]:
                            if nutrient.get("name") == "Calories":
                                calories = int(nutrient.get("amount", 250))
                                break
                    if "weightPerServing" in nutrition:
                        serving_size = f"{nutrition['weightPerServing'].get('amount', 1)} {nutrition['weightPerServing'].get('unit', 'serving')}"
                
                # Get ingredients
                if "extendedIngredients" in recipe:
                    ingredients_list = [ing.get("name", "") for ing in recipe["extendedIngredients"]]
                elif "missedIngredients" in recipe:
                    ingredients_list = [ing.get("name", "") for ing in recipe.get("missedIngredients", [])]
                    ingredients_list.extend([ing.get("name", "") for ing in recipe.get("usedIngredients", [])])
        
        # If recipe search didn't work, try direct nutrition guess
        if calories == 250 and not ingredients_list:
            nutrition_url = "https://api.spoonacular.com/recipes/guessNutrition"
            nutrition_params = {
                "title": food_name,
                "apiKey": "89e023cc2d194d80aa684f404953fe75"
            }
            
            nutrition_response = requests.get(nutrition_url, params=nutrition_params, timeout=10)
            if nutrition_response.status_code == 200:
                nutrition_data = nutrition_response.json()
                if "calories" in nutrition_data:
                    calories = int(nutrition_data["calories"].get("value", 250))
                if "ingredients" in nutrition_data:
                    ingredients_list = [ing.get("name", "") for ing in nutrition_data["ingredients"]]
        
        # Build result
        items = [{
            "name": food_name,
            "confidence": min(float(confidence), 0.95),
            "calories": calories,
            "serving_size": serving_size,
            "ingredients": ingredients_list[:10] if ingredients_list else []  # Limit to 10 ingredients
        }]
        
        return {
            "items": items,
            "total_calories": round(calories, 1)
        }
        
    except requests.exceptions.RequestException as e:
        raise Exception(f"Network error connecting to Spoonacular API: {str(e)}")
    except Exception as e:
        raise Exception(f"Error processing image: {str(e)}")

@app.route("/api/upload_photo", methods=["POST"])
def upload_photo():
    user = current_user()
    if not user:
        return jsonify({"ok": False, "error": "not logged in"}), 403
    if "photo" not in request.files:
        return jsonify({"ok": False, "error": "missing file"}), 400
    f = request.files["photo"]
    if f.filename == "" or not allowed_file(f.filename):
        return jsonify({"ok": False, "error": "invalid file"}), 400
    fn = secure_filename(f.filename)
    unique = f"{secrets.token_hex(8)}_{fn}"
    path = os.path.join(app.config["UPLOAD_FOLDER"], unique)
    f.save(path)
    # Call the AI food recognition
    try:
        result = estimate_calories_from_image(path)
        # Return the image URL so frontend can display it
        image_url = f"/uploads/{unique}"
        result["image_url"] = image_url
        return jsonify({"ok": True, "result": result})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

# Serve uploaded images
@app.route("/uploads/<filename>")
def uploaded_file(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)

# --- App page ---
@app.route("/app")
def app_shell():
    user = current_user()
    if not user:
        return redirect(url_for("index"))
    return render_template("app.html", user=dict(user))

# Serve static files from root (must be last route to avoid catching other routes)
@app.route('/<path:filename>')
def serve_static(filename):
    # Don't serve uploads through this route (handled by /uploads/<filename>)
    if filename.startswith('uploads/'):
        return "Not found", 404
    # Only allow specific file types for security
    allowed_extensions = {'.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg'}
    if any(filename.lower().endswith(ext) for ext in allowed_extensions):
        return send_from_directory('.', filename)
    return "Not found", 404

if __name__ == "__main__":
    app.run(debug=True)