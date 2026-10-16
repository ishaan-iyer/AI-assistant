const STORAGE_KEY = 'study-tracker-ai-v1';

const INITIAL_TASKS = [
  {
    id: 'task-1',
    title: 'Review algebra formulas',
    subject: 'Math',
    duration: 45,
    priority: 'High',
    date: '2026-10-12',
    done: false,
  },
  {
    id: 'task-2',
    title: 'Read chapter 4 summary',
    subject: 'Science',
    duration: 60,
    priority: 'Medium',
    date: '2026-10-13',
    done: false,
  },
  {
    id: 'task-3',
    title: 'Practice vocabulary',
    subject: 'Languages',
    duration: 30,
    priority: 'Low',
    date: '2026-10-14',
    done: true,
  },
];

function createStudyTracker(storage = globalThis.localStorage) {
  const state = { tasks: loadTasks() };

  function loadTasks() {
    if (!storage) {
      return INITIAL_TASKS.map((task) => ({ ...task }));
    }

    const saved = storage.getItem(STORAGE_KEY);
    if (saved === null) {
      return INITIAL_TASKS.map((task) => ({ ...task }));
    }

    const tasks = JSON.parse(saved);
    if (!Array.isArray(tasks)) {
      throw new TypeError(`Stored study tasks must be an array under "${STORAGE_KEY}".`);
    }
    return tasks;
  }

  function saveTasks() {
    if (!storage) {
      throw new Error('Persistent storage is unavailable.');
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
  }

  function addTask(task) {
    if (!task.title?.trim() || !task.subject?.trim()) {
      throw new TypeError('A task title and subject are required.');

    }
    if (!Number.isFinite(task.duration) || task.duration <= 0) {
      throw new TypeError('Task duration must be a positive number of minutes.');
    }

    const newTask = {
      id: task.id ?? globalThis.crypto.randomUUID(),
      title: task.title.trim(),
      subject: task.subject.trim(),
      duration: task.duration,
      priority: task.priority ?? 'Medium',
      date: task.date ?? '',
      done: false,
    };
    state.tasks.push(newTask);
    try {
      saveTasks();
    } catch (error) {
      state.tasks.pop();
      throw error;
    }
    return newTask;
  }

  function toggleTask(id) {
    const task = state.tasks.find((item) => item.id === id);
    if (!task) {
      throw new RangeError(`No study task found with id "${id}".`);
    }

    const previousDone = task.done;
    task.done = !previousDone;
    try {
      saveTasks();
    } catch (error) {
      task.done = previousDone;
      throw error;
    }
    return task;
  }

  function deleteTask(id) {
    const index = state.tasks.findIndex((task) => task.id === id);
    if (index === -1) {
      throw new RangeError(`No study task found with id "${id}".`);
    }

    const [deletedTask] = state.tasks.splice(index, 1);
    try {
      saveTasks();
    } catch (error) {
      state.tasks.splice(index, 0, deletedTask);
      throw error;
    }
    return deletedTask;
  }

  function getSortedTasks() {
    const priorityRank = { High: 3, Medium: 2, Low: 1 };
    return [...state.tasks].sort((a, b) => {
      const priorityDifference =
        (priorityRank[b.priority] ?? 0) - (priorityRank[a.priority] ?? 0);
      if (priorityDifference !== 0) {
        return priorityDifference;
      }
      return Number(a.done) - Number(b.done);
    });
  }

  function generateAssistantNote() {
    const nextTask = getSortedTasks().find((task) => !task.done);
    if (!nextTask) {
      return 'Nice work — everything is complete today. Add one more challenge to keep momentum high.';
    }
    return `Focus on “${nextTask.title}” first. It is the highest-priority task and should take about ${nextTask.duration} minutes.`;
  }

  return {
    state,
    addTask,
    deleteTask,
    getSortedTasks,
    generateAssistantNote,
    saveTasks,
    toggleTask,
  };
}

if (typeof window !== 'undefined') {
  window.StudyTracker = createStudyTracker();
}
