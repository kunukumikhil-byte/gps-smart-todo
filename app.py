from flask import Flask, request, jsonify, render_template
import sqlite3, os

app = Flask(__name__)

# ----- DB init (ok for demo; Render free tier resets on redeploy) -----
def init_db():
    con = sqlite3.connect("tasks.db")
    cur = con.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS tasks(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            latitude REAL,
            longitude REAL
        )
    """)
    con.commit()
    con.close()

init_db()

@app.get("/")
def index():
    # simple health check to avoid template issues
    try:
        return render_template("index.html")
    except Exception:
        return "OK - Flask is running (template missing?)", 200

@app.post("/add")
def add_task():
    data = request.get_json(force=True)
    con = sqlite3.connect("tasks.db")
    cur = con.cursor()
    cur.execute(
        "INSERT INTO tasks(title, latitude, longitude) VALUES (?,?,?)",
        (data["title"], data["lat"], data["lng"])
    )
    con.commit(); con.close()
    return jsonify({"message": "Task Saved"})

@app.get("/tasks")
def get_tasks():
    con = sqlite3.connect("tasks.db")
    cur = con.cursor()
    cur.execute("SELECT * FROM tasks")
    rows = cur.fetchall()
    con.close()
    return jsonify(rows)

@app.delete("/delete/<int:task_id>")
def delete_task(task_id):
    con = sqlite3.connect("tasks.db")
    cur = con.cursor()
    cur.execute("DELETE FROM tasks WHERE id=?", (task_id,))
    con.commit(); con.close()
    return jsonify({"message": "Task Deleted"})

# DO NOT run Flask server on import; gunicorn will handle it
if __name__ == "__main__":
    app.run()   # for local dev only