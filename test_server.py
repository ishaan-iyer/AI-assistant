import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import server


class StudyTrackerApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = tempfile.TemporaryDirectory()
        cls.original_database_path = server.DATABASE_PATH
        server.DATABASE_PATH = Path(cls.database.name) / "test.db"
        server.initialize_database()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.StudyTrackerHandler)
        cls.base_url = f"http://127.0.0.1:{cls.httpd.server_port}"
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join()
        server.DATABASE_PATH = cls.original_database_path
        cls.database.cleanup()

    def request_json(self, path, method="GET", payload=None):
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            self.base_url + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json"},
        )
        try:
            response = urlopen(request)
        except HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read())

    def test_task_create_edit_complete_delete_persists(self):
        status, response = self.request_json(
            "/api/tasks",
            "POST",
            {
                "title": "Review functions",
                "subject": "Math",
                "duration": 30,
                "priority": "High",
                "date": "",
            },
        )
        self.assertEqual(status, 201)
        task_id = response["task"]["id"]

        status, response = self.request_json(
            f"/api/tasks/{task_id}",
            "PATCH",
            {"title": "Review functions and graphs", "done": True},
        )
        self.assertEqual(status, 200)
        self.assertTrue(response["task"]["done"])
        self.assertEqual(response["task"]["title"], "Review functions and graphs")

        status, response = self.request_json(f"/api/tasks/{task_id}", "DELETE")
        self.assertEqual(status, 200)
        self.assertTrue(response["deleted"])

        status, response = self.request_json("/api/tasks")
        self.assertEqual(status, 200)
        self.assertNotIn(task_id, [task["id"] for task in response["tasks"]])

    def test_timer_session_updates_weekly_subject_stats(self):
        status, response = self.request_json(
            "/api/sessions",
            "POST",
            {"subject": "Physics", "duration_seconds": 125, "task_id": None},
        )
        self.assertEqual(status, 201)
        self.assertEqual(response["session"]["duration_seconds"], 125)

        status, response = self.request_json("/api/stats")
        self.assertEqual(status, 200)
        self.assertGreaterEqual(response["weekly_by_subject"]["Physics"], 125)

    def test_assistant_generates_practice_questions(self):
        status, response = self.request_json(
            "/api/assistant",
            "POST",
            {"intent": "practice", "topic": "fractions"},
        )
        self.assertEqual(status, 200)
        self.assertIn("fractions", response["reply"])
        self.assertIn("3.", response["reply"])

    def test_assistant_explains_known_concept(self):
        status, response = self.request_json(
            "/api/assistant",
            "POST",
            {"intent": "explain", "topic": "slope"},
        )
        self.assertEqual(status, 200)
        self.assertIn("rise over run", response["reply"])

    def test_invalid_task_is_rejected(self):
        status, response = self.request_json(
            "/api/tasks",
            "POST",
            {"title": "", "subject": "Math", "duration": 30, "priority": "High"},
        )
        self.assertEqual(status, 400)
        self.assertIn("title", response["error"].lower())


if __name__ == "__main__":
    unittest.main()
