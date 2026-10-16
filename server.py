import argparse
import json
import sqlite3
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse


APP_DIR = Path(__file__).resolve().parent
DATABASE_PATH = APP_DIR / "study_tracker.db"
PRIORITIES = {"Low", "Medium", "High"}
PRIORITY_ORDER = {"High": 0, "Medium": 1, "Low": 2}


def connect_database() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database() -> None:
    with closing(connect_database()) as connection, connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS study_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                subject TEXT NOT NULL,
                duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
                priority TEXT NOT NULL CHECK (priority IN ('Low', 'Medium', 'High')),
                due_date TEXT,
                completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS study_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subject TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
                started_at TEXT NOT NULL,
                task_id INTEGER REFERENCES study_tasks(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        count = connection.execute("SELECT COUNT(*) FROM study_tasks").fetchone()[0]
        if count == 0:
            connection.executemany(
                """
                INSERT INTO study_tasks
                    (title, subject, duration_minutes, priority, due_date, completed)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [
                    ("Review algebra formulas", "Math", 45, "High", None, 0),
                    ("Read chapter 4 summary", "Science", 60, "Medium", None, 0),
                    ("Practice vocabulary", "Languages", 30, "Low", None, 1),
                ],
            )


def task_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "subject": row["subject"],
        "duration": row["duration_minutes"],
        "priority": row["priority"],
        "date": row["due_date"] or "",
        "done": bool(row["completed"]),
    }


def validate_task(data: dict, existing: dict | None = None) -> dict:
    merged = {**(existing or {}), **data}
    title = merged.get("title")
    subject = merged.get("subject")
    duration = merged.get("duration")
    priority = merged.get("priority", "Medium")
    due_date = merged.get("date") or ""

    if not isinstance(title, str) or not title.strip():
        raise ValueError("Task title is required.")
    if not isinstance(subject, str) or not subject.strip():
        raise ValueError("Subject is required.")
    if isinstance(duration, bool) or not isinstance(duration, int) or duration < 1 or duration > 1440:
        raise ValueError("Duration must be a whole number from 1 to 1440 minutes.")
    if not isinstance(priority, str) or priority not in PRIORITIES:
        raise ValueError("Priority must be Low, Medium, or High.")
    if due_date:
        try:
            date.fromisoformat(due_date)
        except (TypeError, ValueError) as error:
            raise ValueError("Due date must be a valid YYYY-MM-DD date.") from error

    done = merged.get("done", False)
    if not isinstance(done, bool):
        raise ValueError("Task completion must be true or false.")

    return {
        "title": title.strip(),
        "subject": subject.strip(),
        "duration": duration,
        "priority": priority,
        "date": due_date,
        "done": done,
    }


def assistant_reply(data: dict) -> dict:
    intent = data.get("intent", "suggest")
    topic = str(data.get("topic", "")).strip()
    if not isinstance(intent, str):
        raise ValueError("Choose explain, practice, or suggest.")
    if intent in {"explain", "practice"} and not topic:
        raise ValueError("Enter a concept or subject first.")

    if intent == "suggest":
        tasks = data.get("tasks", [])
        if not isinstance(tasks, list):
            raise ValueError("Tasks for suggestions must be provided as a list.")
        pending = [
            task for task in tasks
            if isinstance(task, dict) and not task.get("done")
        ]
        pending.sort(
            key=lambda task: (
                PRIORITY_ORDER.get(task.get("priority"), 3),
                task.get("date") or "9999-12-31",
            )
        )
        if not pending:
            return {"reply": "You are caught up. Add a task for a subject you want to strengthen next."}
        next_task = pending[0]
        return {
            "reply": (
                f"Start with “{next_task.get('title', 'your next task')}” "
                f"for {next_task.get('duration', 30)} minutes. It is a "
                f"{next_task.get('priority', 'Medium').lower()}-priority "
                f"{next_task.get('subject', 'study')} task."
            )
        }

    if intent == "practice":
        return {
            "reply": (
                f"Practice questions for {topic}:\n"
                f"1. Explain the main idea of {topic} in your own words.\n"
                f"2. What is one example of {topic}, and why does it fit?\n"
                f"3. What common mistake should someone avoid when working with {topic}?"
            )
        }

    if intent == "explain":
        known_explanations = {
            "photosynthesis": (
                "Photosynthesis is how plants use light energy to turn water and carbon "
                "dioxide into sugar, releasing oxygen. Think of a leaf as a small solar-powered "
                "kitchen: light supplies the energy, and sugar stores it."
            ),
            "osmosis": (
                "Osmosis is the movement of water through a selectively permeable membrane "
                "from a region with fewer dissolved particles to one with more, until the "
                "concentrations become more balanced."
            ),
            "mitosis": (
                "Mitosis is the process by which one cell divides its copied chromosomes "
                "between two genetically similar daughter cells. It supports growth and tissue repair."
            ),
            "slope": (
                "Slope measures how much y changes for a given change in x. Calculate it as "
                "rise over run: (y2 − y1) / (x2 − x1). A larger absolute slope means a steeper line."
            ),
        }
        explanation = known_explanations.get(topic.casefold())
        if explanation is None:
            explanation = (
                f"To understand {topic}, start by defining its key idea, identify the parts "
                "or steps involved, and work through one concrete example. Then explain why "
                "the example fits and check your understanding with a question of your own. "
                "This local study helper has no external language model, so its explanations "
                "are general learning guidance rather than a topic-specific expert answer."
            )
        return {"reply": explanation}

    raise ValueError("Choose explain, practice, or suggest.")


class StudyTrackerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def log_message(self, format_string: str, *args) -> None:
        print(f"{self.log_date_time_string()} {self.address_string()} {format_string % args}")

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 100_000:
                raise ValueError("Request body must be between 1 byte and 100 KB.")
            payload = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError("Request body must contain valid JSON.") from error
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        return payload

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/tasks":
            self.get_tasks(parse_qs(parsed.query))
        elif parsed.path == "/api/stats":
            self.get_stats()
        else:
            super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            data = self.read_json()
            if parsed.path == "/api/tasks":
                self.create_task(data)
            elif parsed.path == "/api/sessions":
                self.create_session(data)
            elif parsed.path == "/api/assistant":
                self.send_json(200, assistant_reply(data))
            else:
                self.send_json(404, {"error": "API endpoint not found."})
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except sqlite3.Error as error:
            print(f"Database error: {error}")
            self.send_json(500, {"error": "Could not save data to the database."})

    def do_PATCH(self) -> None:
        task_id = self.task_id_from_path()
        if task_id is None:
            self.send_json(404, {"error": "Task endpoint not found."})
            return
        try:
            data = self.read_json()
            with closing(connect_database()) as connection, connection:
                row = connection.execute(
                    "SELECT * FROM study_tasks WHERE id = ?", (task_id,)
                ).fetchone()
                if row is None:
                    self.send_json(404, {"error": "Task not found."})
                    return
                validated = validate_task(data, task_to_dict(row))
                connection.execute(
                    """
                    UPDATE study_tasks
                    SET title = ?, subject = ?, duration_minutes = ?, priority = ?,
                        due_date = ?, completed = ?
                    WHERE id = ?
                    """,
                    (
                        validated["title"],
                        validated["subject"],
                        validated["duration"],
                        validated["priority"],
                        validated["date"] or None,
                        int(validated["done"]),
                        task_id,
                    ),
                )
                updated = connection.execute(
                    "SELECT * FROM study_tasks WHERE id = ?", (task_id,)
                ).fetchone()
            self.send_json(200, {"task": task_to_dict(updated)})
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except sqlite3.Error as error:
            print(f"Database error: {error}")
            self.send_json(500, {"error": "Could not update the task."})

    def do_DELETE(self) -> None:
        task_id = self.task_id_from_path()
        if task_id is None:
            self.send_json(404, {"error": "Task endpoint not found."})
            return
        try:
            with closing(connect_database()) as connection, connection:
                cursor = connection.execute(
                    "DELETE FROM study_tasks WHERE id = ?", (task_id,)
                )
                if cursor.rowcount == 0:
                    self.send_json(404, {"error": "Task not found."})
                    return
            self.send_json(200, {"deleted": True, "id": task_id})
        except sqlite3.Error as error:
            print(f"Database error: {error}")
            self.send_json(500, {"error": "Could not delete the task."})

    def task_id_from_path(self) -> int | None:
        parts = urlparse(self.path).path.strip("/").split("/")
        if len(parts) != 3 or parts[:2] != ["api", "tasks"]:
            return None
        try:
            task_id = int(parts[2])
        except ValueError:
            return None
        return task_id if task_id > 0 else None

    def get_tasks(self, query: dict[str, list[str]]) -> None:
        subject = query.get("subject", [""])[0].strip()
        with closing(connect_database()) as connection, connection:
            if subject:
                rows = connection.execute(
                    "SELECT * FROM study_tasks WHERE subject = ? ORDER BY id DESC",
                    (subject,),
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT * FROM study_tasks ORDER BY id DESC"
                ).fetchall()
        self.send_json(200, {"tasks": [task_to_dict(row) for row in rows]})

    def create_task(self, data: dict) -> None:
        task = validate_task(data)
        with closing(connect_database()) as connection, connection:
            cursor = connection.execute(
                """
                INSERT INTO study_tasks
                    (title, subject, duration_minutes, priority, due_date, completed)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    task["title"],
                    task["subject"],
                    task["duration"],
                    task["priority"],
                    task["date"] or None,
                    int(task["done"]),
                ),
            )
            row = connection.execute(
                "SELECT * FROM study_tasks WHERE id = ?", (cursor.lastrowid,)
            ).fetchone()
        self.send_json(201, {"task": task_to_dict(row)})

    def get_stats(self) -> None:
        now = datetime.now(timezone.utc)
        week_start = (now - timedelta(days=now.weekday())).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        with closing(connect_database()) as connection, connection:
            counts = connection.execute(
                """
                SELECT COUNT(*) AS total,
                       COALESCE(SUM(completed), 0) AS completed
                FROM study_tasks
                """
            ).fetchone()
            sessions = connection.execute(
                """
                SELECT subject, SUM(duration_seconds) AS seconds
                FROM study_sessions
                WHERE started_at >= ?
                GROUP BY subject
                ORDER BY seconds DESC
                """,
                (week_start.isoformat(),),
            ).fetchall()
        by_subject = {row["subject"]: row["seconds"] for row in sessions}
        self.send_json(
            200,
            {
                "tasks_total": counts["total"],
                "tasks_completed": counts["completed"],
                "weekly_seconds": sum(by_subject.values()),
                "weekly_by_subject": by_subject,
            },
        )

    def create_session(self, data: dict) -> None:
        subject = data.get("subject")
        seconds = data.get("duration_seconds")
        task_id = data.get("task_id")
        if not isinstance(subject, str) or not subject.strip():
            raise ValueError("Choose a subject for the study session.")
        if isinstance(seconds, bool) or not isinstance(seconds, int) or not 1 <= seconds <= 86_400:
            raise ValueError("Study session duration must be between 1 second and 24 hours.")
        if task_id is not None and (isinstance(task_id, bool) or not isinstance(task_id, int)):
            raise ValueError("Task id must be an integer.")

        started_at = datetime.now(timezone.utc).isoformat()
        with closing(connect_database()) as connection, connection:
            if task_id is not None and connection.execute(
                "SELECT 1 FROM study_tasks WHERE id = ?", (task_id,)
            ).fetchone() is None:
                raise ValueError("Selected task no longer exists.")
            cursor = connection.execute(
                """
                INSERT INTO study_sessions (subject, duration_seconds, started_at, task_id)
                VALUES (?, ?, ?, ?)
                """,
                (subject.strip(), seconds, started_at, task_id),
            )
        self.send_json(
            201,
            {
                "session": {
                    "id": cursor.lastrowid,
                    "subject": subject.strip(),
                    "duration_seconds": seconds,
                    "started_at": started_at,
                    "task_id": task_id,
                }
            },
        )

    def translate_path(self, path: str) -> str:
        decoded = unquote(urlparse(path).path)
        if decoded == "/":
            decoded = "/index.html"
        requested = (APP_DIR / decoded.lstrip("/")).resolve()
        if requested != APP_DIR and APP_DIR not in requested.parents:
            return str(APP_DIR / "__not_found__")
        return str(requested)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the study tracker web app.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()

    initialize_database()
    server = ThreadingHTTPServer((args.host, args.port), StudyTrackerHandler)
    print(f"Study tracker running at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping study tracker.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
