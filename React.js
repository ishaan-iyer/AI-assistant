const { createElement: h, useEffect, useMemo, useState } = React;

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }
  return payload;
}

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const remainder = String(seconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${remainder}`;
}

function formatMinutes(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

function App() {
  const [tasks, setTasks] = useState([]);
  const [stats, setStats] = useState({
    tasks_total: 0,
    tasks_completed: 0,
    weekly_seconds: 0,
    weekly_by_subject: {},
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterSubject, setFilterSubject] = useState('All subjects');
  const [form, setForm] = useState({
    title: '',
    subject: '',
    duration: 45,
    priority: 'Medium',
    date: '',
  });
  const [editingId, setEditingId] = useState(null);
  const [timerSubject, setTimerSubject] = useState('');
  const [timerTaskId, setTimerTaskId] = useState('');
  const [timer, setTimer] = useState(null);
  const [clockNow, setClockNow] = useState(Date.now());
  const [assistantIntent, setAssistantIntent] = useState('suggest');
  const [assistantTopic, setAssistantTopic] = useState('');
  const [assistantReply, setAssistantReply] = useState('');
  const [assistantBusy, setAssistantBusy] = useState(false);

  async function refreshData() {
    const [taskData, statsData] = await Promise.all([
      api('/api/tasks'),
      api('/api/stats'),
    ]);
    setTasks(taskData.tasks);
    setStats(statsData);
  }

  useEffect(() => {
    refreshData()
      .catch((loadError) => setError(loadError.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!timer || timer.status !== 'running') return undefined;
    const interval = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [timer]);

  const subjects = useMemo(
    () => [...new Set(tasks.map((task) => task.subject))].sort((a, b) => a.localeCompare(b)),
    [tasks]
  );
  const shownTasks = filterSubject === 'All subjects'
    ? tasks
    : tasks.filter((task) => task.subject === filterSubject);
  const pendingTasks = tasks.filter((task) => !task.done);
  const timerElapsed = timer
    ? timer.elapsed + (timer.status === 'running' ? (clockNow - timer.runningAt) / 1000 : 0)
    : 0;
  const weeklyMinutes = Math.floor(stats.weekly_seconds / 60);

  function updateForm(event) {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: name === 'duration' ? Number(value) : value,
    }));
  }

  async function submitTask(event) {
    event.preventDefault();
    setError('');
    try {
      if (editingId !== null) {
        await api(`/api/tasks/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(form),
        });
      } else {
        await api('/api/tasks', {
          method: 'POST',
          body: JSON.stringify(form),
        });
      }
      setForm({ title: '', subject: '', duration: 45, priority: 'Medium', date: '' });
      setEditingId(null);
      await refreshData();
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  function beginEdit(task) {
    setEditingId(task.id);
    setForm({
      title: task.title,
      subject: task.subject,
      duration: task.duration,
      priority: task.priority,
      date: task.date,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm({ title: '', subject: '', duration: 45, priority: 'Medium', date: '' });
  }

  async function toggleTask(task) {
    setError('');
    try {
      await api(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ done: !task.done }),
      });
      await refreshData();
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  async function deleteTask(task) {
    setError('');
    try {
      await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
      if (String(task.id) === timerTaskId) setTimerTaskId('');
      setTimer((currentTimer) => (
        currentTimer && String(currentTimer.taskId) === String(task.id)
          ? { ...currentTimer, taskId: null }
          : currentTimer
      ));
      await refreshData();
    } catch (actionError) {
      setError(actionError.message);
    }
  }

  function startTimer() {
    if (!timerSubject.trim()) {
      setError('Choose or enter a subject before starting the timer.');
      return;
    }
    setError('');
    setClockNow(Date.now());
    setTimer({
      status: 'running',
      elapsed: 0,
      runningAt: Date.now(),
      subject: timerSubject.trim(),
      taskId: timerTaskId ? Number(timerTaskId) : null,
    });
  }

  function pauseTimer() {
    if (!timer || timer.status !== 'running') return;
    const elapsed = timer.elapsed + (Date.now() - timer.runningAt) / 1000;
    setTimer({ ...timer, status: 'paused', elapsed });
  }

  function resumeTimer() {
    if (!timer || timer.status !== 'paused') return;
    const now = Date.now();
    setClockNow(now);
    setTimer({ ...timer, status: 'running', runningAt: now });
  }

  async function stopTimer() {
    if (!timer) return;
    const durationSeconds = Math.floor(timerElapsed);
    const currentTimer = timer;
    setTimer(null);
    if (durationSeconds < 1) {
      setError('Study session was under one second and was not recorded.');
      return;
    }
    setError('');
    try {
      await api('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          subject: currentTimer.subject,
          duration_seconds: durationSeconds,
          task_id: currentTimer.taskId,
        }),
      });
      await refreshData();
    } catch (actionError) {
      setError(actionError.message);
      setTimer({
        ...currentTimer,
        status: 'paused',
        elapsed: durationSeconds,
      });
    }
  }

  async function askAssistant(event) {
    event.preventDefault();
    setAssistantBusy(true);
    setAssistantReply('');
    setError('');
    try {
      const response = await api('/api/assistant', {
        method: 'POST',
        body: JSON.stringify({
          intent: assistantIntent,
          topic: assistantTopic,
          tasks,
        }),
      });
      setAssistantReply(response.reply);
    } catch (assistantError) {
      setError(assistantError.message);
    } finally {
      setAssistantBusy(false);
    }
  }

  const weeklyRows = Object.entries(stats.weekly_by_subject)
    .sort((a, b) => b[1] - a[1]);
  const weeklyMax = Math.max(1, ...weeklyRows.map(([, seconds]) => seconds));

  return h('div', { className: 'app-shell' },
    h('aside', { className: 'sidebar' },
      h('div', null,
        h('p', { className: 'eyebrow' }, 'Learning Hub'),
        h('h1', null, 'StudyTracker AI')
      ),
      h('nav', { className: 'side-nav', 'aria-label': 'Main navigation' },
        h('a', { className: 'nav-item active', href: '#dashboard' }, 'Dashboard'),
        h('a', { className: 'nav-item', href: '#tasks' }, 'Tasks'),
        h('a', { className: 'nav-item', href: '#timer' }, 'Study timer'),
        h('a', { className: 'nav-item', href: '#assistant' }, 'AI assistant')
      ),
      h('div', { className: 'assistant-card' },
        h('p', { className: 'eyebrow secondary' }, 'Next focus'),
        h('h2', null, 'Study suggestion'),
        h('p', null, pendingTasks.length
          ? `Start with ${pendingTasks[0].title} (${pendingTasks[0].duration} min).`
          : 'You are caught up. Add a task to plan your next study session.')
      )
    ),
    h('main', { className: 'main-panel', id: 'dashboard' },
      h('header', { className: 'topbar' },
        h('div', null,
          h('p', { className: 'eyebrow dark' }, 'Personal study tracker'),
          h('h2', null, 'Welcome back')
        ),
        h('a', { className: 'primary-btn button-link', href: '#task-form' }, '+ Add task')
      ),
      error && h('p', { className: 'error-message', role: 'alert' }, error),
      h('section', { className: 'stats-grid', 'aria-label': 'Study statistics' },
        h('article', { className: 'stat-card accent' },
          h('span', { className: 'stat-label' }, 'Tasks due'),
          h('strong', null, `${pendingTasks.length}`)
        ),
        h('article', { className: 'stat-card' },
          h('span', { className: 'stat-label' }, 'Completed'),
          h('strong', null, `${stats.tasks_completed}`)
        ),
        h('article', { className: 'stat-card' },
          h('span', { className: 'stat-label' }, 'Study this week'),
          h('strong', null, `${formatMinutes(weeklyMinutes)}`)
        ),
        h('article', { className: 'stat-card' },
          h('span', { className: 'stat-label' }, 'Total tasks'),
          h('strong', null, `${stats.tasks_total}`)
        )
      ),
      h('section', { className: 'panel-row', id: 'tasks' },
        h('section', { className: 'panel task-panel' },
          h('div', { className: 'panel-header' },
            h('h3', null, editingId === null ? 'Study tasks' : 'Edit study task'),
            h('span', { className: 'pill' }, `${shownTasks.length} shown`)
          ),
          h('form', { id: 'task-form', className: 'task-form', onSubmit: submitTask },
            h('div', { className: 'field-row' },
              h('label', null,
                h('span', null, 'Task title'),
                h('input', {
                  name: 'title',
                  value: form.title,
                  onChange: updateForm,
                  placeholder: 'e.g. Algebra review set',
                  required: true,
                })
              ),
              h('label', null,
                h('span', null, 'Subject'),
                h('input', {
                  name: 'subject',
                  value: form.subject,
                  onChange: updateForm,
                  placeholder: 'Math',
                  list: 'subject-options',
                  required: true,
                }),
                h('datalist', { id: 'subject-options' },
                  subjects.map((subject) => h('option', { key: subject, value: subject }))
                )
              )
            ),
            h('div', { className: 'field-row' },
              h('label', null,
                h('span', null, 'Duration (minutes)'),
                h('input', {
                  name: 'duration',
                  type: 'number',
                  min: 1,
                  max: 1440,
                  value: form.duration,
                  onChange: updateForm,
                  required: true,
                })
              ),
              h('label', null,
                h('span', null, 'Priority'),
                h('select', { name: 'priority', value: form.priority, onChange: updateForm },
                  ['High', 'Medium', 'Low'].map((priority) =>
                    h('option', { key: priority, value: priority }, priority)
                  )
                )
              )
            ),
            h('div', { className: 'field-row inline' },
              h('label', null,
                h('span', null, 'Due date'),
                h('input', { name: 'date', type: 'date', value: form.date, onChange: updateForm })
              ),
              h('div', { className: 'form-actions' },
                editingId !== null && h('button', {
                  className: 'secondary-btn',
                  type: 'button',
                  onClick: cancelEdit,
                }, 'Cancel'),
                h('button', { className: 'primary-btn', type: 'submit' },
                  editingId === null ? 'Save task' : 'Update task'
                )
              )
            )
          ),
          h('div', { className: 'task-toolbar' },
            h('label', { className: 'filter-control' },
              h('span', null, 'Filter by subject'),
              h('select', {
                value: filterSubject,
                onChange: (event) => setFilterSubject(event.target.value),
              },
                h('option', { value: 'All subjects' }, 'All subjects'),
                subjects.map((subject) => h('option', { key: subject, value: subject }, subject))
              )
            )
          ),
          loading
            ? h('p', { className: 'empty-state' }, 'Loading your saved study tasks...')
            : shownTasks.length
              ? h('div', { className: 'task-list', 'aria-live': 'polite' },
                shownTasks.map((task) =>
                  h('article', {
                    key: task.id,
                    className: `task-item ${task.done ? 'completed' : ''}`,
                  },
                    h('div', { className: 'task-main' },
                      h('div', { className: 'task-title-row' },
                        h('input', {
                          className: 'task-check',
                          type: 'checkbox',
                          checked: task.done,
                          onChange: () => toggleTask(task),
                          'aria-label': `Mark ${task.title} ${task.done ? 'incomplete' : 'complete'}`,
                        }),
                        h('span', { className: 'task-title' }, task.title)
                      ),
                      h('div', { className: 'task-meta' },
                        h('span', { className: `task-badge ${task.priority.toLowerCase()}` }, task.priority),
                        h('span', { className: 'subject-tag' }, task.subject),
                        h('span', null, `${task.duration} min`),
                        h('span', null, task.date || 'No due date')
                      )
                    ),
                    h('div', { className: 'task-actions' },
                      h('button', {
                        className: 'edit-btn',
                        type: 'button',
                        onClick: () => beginEdit(task),
                      }, 'Edit'),
                      h('button', {
                        className: 'delete-btn',
                        type: 'button',
                        onClick: () => deleteTask(task),
                      }, 'Delete')
                    )
                  )
                )
              )
              : h('p', { className: 'empty-state' }, 'No tasks in this subject yet. Add a task above.')
        ),
        h('section', { className: 'panel chart-panel' },
          h('div', { className: 'panel-header' },
            h('h3', null, 'Weekly progress'),
            h('span', { className: 'pill muted' }, 'This week')
          ),
          h('p', { className: 'weekly-total' }, `${formatMinutes(weeklyMinutes)} studied`),
          weeklyRows.length
            ? h('div', { className: 'subject-chart' },
              weeklyRows.map(([subject, seconds]) =>
                h('div', { className: 'chart-row', key: subject },
                  h('span', { className: 'chart-label' }, subject),
                  h('div', { className: 'bar-track' },
                    h('span', {
                      className: 'bar-fill',
                      style: { width: `${Math.max(8, seconds / weeklyMax * 100)}%` },
                    })
                  ),
                  h('strong', null, formatMinutes(Math.floor(seconds / 60)))
                )
              )
            )
            : h('p', { className: 'empty-state' }, 'Finish a timer session to see study time by subject.')
        )
      ),
      h('section', { className: 'feature-grid' },
        h('section', { className: 'panel timer-panel', id: 'timer' },
          h('div', { className: 'panel-header' },
            h('h3', null, 'Study timer'),
            h('span', { className: 'pill muted' }, 'Sessions save to SQLite')
          ),
          h('div', { className: 'timer-face', 'aria-live': 'off' }, formatTime(timerElapsed)),
          h('div', { className: 'timer-controls' },
            h('label', null,
              h('span', null, 'Subject'),
              h('input', {
                value: timerSubject,
                onChange: (event) => setTimerSubject(event.target.value),
                list: 'timer-subject-options',
                disabled: Boolean(timer),
                placeholder: 'Choose a subject',
              }),
              h('datalist', { id: 'timer-subject-options' },
                subjects.map((subject) => h('option', { key: subject, value: subject }))
              )
            ),
            h('label', null,
              h('span', null, 'Link to a task (optional)'),
              h('select', {
                value: timerTaskId,
                disabled: Boolean(timer),
                onChange: (event) => {
                  const taskId = event.target.value;
                  setTimerTaskId(taskId);
                  const selectedTask = tasks.find((task) => String(task.id) === taskId);
                  if (selectedTask) setTimerSubject(selectedTask.subject);
                },
              },
                h('option', { value: '' }, 'No linked task'),
                tasks.map((task) => h('option', { key: task.id, value: task.id }, task.title))
              )
            )
          ),
          h('div', { className: 'timer-buttons' },
            !timer && h('button', { className: 'primary-btn', type: 'button', onClick: startTimer }, 'Start'),
            timer?.status === 'running' && h('button', { className: 'secondary-btn', type: 'button', onClick: pauseTimer }, 'Pause'),
            timer?.status === 'paused' && h('button', { className: 'primary-btn', type: 'button', onClick: resumeTimer }, 'Resume'),
            timer && h('button', { className: 'delete-btn', type: 'button', onClick: stopTimer }, 'Stop & save session')
          )
        ),
        h('section', { className: 'panel assistant-panel', id: 'assistant' },
          h('div', { className: 'panel-header' },
            h('h3', null, 'AI study assistant'),
            h('span', { className: 'pill' }, 'Study coach')
          ),
          h('form', { className: 'assistant-form', onSubmit: askAssistant },
            h('label', null,
              h('span', null, 'What should I help with?'),
              h('select', {
                value: assistantIntent,
                onChange: (event) => setAssistantIntent(event.target.value),
              },
                h('option', { value: 'suggest' }, 'Suggest a study task'),
                h('option', { value: 'explain' }, 'Explain a concept'),
                h('option', { value: 'practice' }, 'Generate practice questions')
              )
            ),
            assistantIntent !== 'suggest' && h('label', null,
              h('span', null, 'Concept or topic'),
              h('input', {
                value: assistantTopic,
                onChange: (event) => setAssistantTopic(event.target.value),
                placeholder: 'e.g. photosynthesis',
                required: true,
              })
            ),
            h('button', { className: 'primary-btn', type: 'submit', disabled: assistantBusy },
              assistantBusy ? 'Thinking...' : 'Ask assistant'
            )
          ),
          assistantReply && h('div', { className: 'assistant-reply', 'aria-live': 'polite' }, assistantReply),
          h('p', { className: 'assistant-disclaimer' }, 'The built-in coach runs locally with study prompts and templates; it does not call an external AI service.')
        )
      )
    )
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(h(App));
