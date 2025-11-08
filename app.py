from flask import Flask, request, jsonify, render_template
import sqlite3

app = Flask(__name__)

# ---------------------------
# Database initialization
# ---------------------------
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


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/add", methods=["POST"])
def add_task():
    data = request.json
    con = sqlite3.connect("tasks.db")
    cur = con.cursor()
    cur.execute(
        "INSERT INTO tasks (title, latitude, longitude) VALUES (?, ?, ?)",
        (data["title"], data["lat"], data["lng"])
    )
    con.commit()
    con.close()
    return jsonify({"message": "Task Saved"})


@app.route("/tasks")
def get_tasks():
    con = sqlite3.connect("tasks.db")
    cur = con.cursor()
    cur.execute("SELECT * FROM tasks")
    tasks = cur.fetchall()
    con.close()
    return jsonify(tasks)

# ✅ NEW — Delete task
@app.route("/delete/<int:task_id>", methods=["DELETE"])
def delete_task(task_id):
    con = sqlite3.connect("tasks.db")
    cur = con.cursor()
    cur.execute("DELETE FROM tasks WHERE id=?", (task_id,))
    con.commit()
    con.close()
    return jsonify({"message": "Task Deleted!"})


if __name__ == "__main__":
    app.run(debug=True)