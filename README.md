# StudyTracker AI

A React and JavaScript study dashboard backed by a Python standard-library HTTP API and SQLite.

## Features

- Create, edit, delete, complete, and filter tasks by subject.
- Run, pause, and save study-timer sessions.
- Persist tasks and timed sessions in SQLite; show completed-task counts and weekly study time by subject.
- Ask the built-in study coach for task suggestions, concept explanations, and practice questions.

The study coach uses local rules and templates. It does not call an external language model; generic explanations are identified as general guidance.

## Run locally

Use Python 3.10 or newer. No Python packages are required.

```bash
python3 server.py
```

Open http://127.0.0.1:8001/ in a browser. The first start creates `study_tracker.db` and adds sample tasks. The database file is kept in this folder and is excluded from Git.

The interface loads React 18 from unpkg, so a network connection is needed when opening the app.

## Run tests

```bash
python3 -m unittest -v test_server.py
```

## Project files

- `index.html`, `React.js`, `styles.css` — React-powered client interface.
- `server.py` — HTTP API, input validation, assistant responses, and SQLite persistence.
- `SQLite` — reference SQL schema; the Python server creates the tables automatically.
- `test_server.py` — API and database tests.
