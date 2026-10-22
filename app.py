from pathlib import Path
import math
import os
import sqlite3

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
BASE_DIR = Path(__file__).resolve().parent

# SQLite on Vercel is only temporary. Use a managed database for persistent,
# multi-instance production storage. /tmp is the writable function directory.
if os.getenv("VERCEL"):
    DB_PATH = Path(os.getenv("TASKS_DB", "/tmp/gps-smart-todo/tasks.db"))
else:
    DB_PATH = Path(os.getenv("TASKS_DB", str(BASE_DIR / "tasks.db")))
if not DB_PATH.is_absolute():
    DB_PATH = BASE_DIR / DB_PATH


def connect_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(DB_PATH), timeout=10)
    connection.execute("PRAGMA busy_timeout = 10000")
    return connection


def init_db():
    with connect_db() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                latitude REAL,
                longitude REAL
            )
        """)
        connection.execute("CREATE INDEX IF NOT EXISTS idx_tasks_id ON tasks(id)")


init_db()


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "GPS Smart To-Do"})


@app.post("/add")
def add_task():
    if not request.is_json:
        return jsonify({"error": "Send task data as JSON."}), 415
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "A valid JSON object is required."}), 400

    title = data.get("title")
    if not isinstance(title, str) or not title.strip():
        return jsonify({"error": "Task name is required."}), 400
    title = title.strip()
    if len(title) > 200:
        return jsonify({"error": "Task name must be 200 characters or fewer."}), 400

    lat, lng = data.get("lat"), data.get("lng")
    if lat is None and lng is None:
        lat, lng = None, None
    elif lat is None or lng is None:
        return jsonify({"error": "Provide both latitude and longitude."}), 400
    else:
        try:
            lat, lng = float(lat), float(lng)
        except (TypeError, ValueError):
            return jsonify({"error": "Coordinates must be valid numbers."}), 400
        if not math.isfinite(lat) or not math.isfinite(lng):
            return jsonify({"error": "Coordinates must be finite numbers."}), 400
        if not -90 <= lat <= 90 or not -180 <= lng <= 180:
            return jsonify({"error": "Coordinates are outside the valid range."}), 400

    try:
        with connect_db() as connection:
            cursor = connection.execute(
                "INSERT INTO tasks(title, latitude, longitude) VALUES (?, ?, ?)",
                (title, lat, lng),
            )
            task_id = cursor.lastrowid
        return jsonify({
            "message": "Task saved",
            "task": {"id": task_id, "title": title, "latitude": lat, "longitude": lng},
        }), 201
    except sqlite3.Error:
        app.logger.exception("Task save failed")
        return jsonify({"error": "Unable to save the task right now."}), 500


@app.get("/tasks")
def get_tasks():
    try:
        with connect_db() as connection:
            tasks = connection.execute(
                "SELECT id, title, latitude, longitude FROM tasks ORDER BY id DESC"
            ).fetchall()
        return jsonify(tasks)
    except sqlite3.Error:
        app.logger.exception("Task list failed")
        return jsonify({"error": "Unable to load tasks right now."}), 500


@app.delete("/delete/<int:task_id>")
def delete_task(task_id):
    try:
        with connect_db() as connection:
            cursor = connection.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
            deleted = cursor.rowcount > 0
        if not deleted:
            return jsonify({"error": "Task not found."}), 404
        return jsonify({"message": "Task deleted"})
    except sqlite3.Error:
        app.logger.exception("Task delete failed")
        return jsonify({"error": "Unable to delete the task right now."}), 500


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true")
