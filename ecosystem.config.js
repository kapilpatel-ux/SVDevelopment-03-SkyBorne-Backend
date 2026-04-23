module.exports = {
  apps: [
    {
      name: "skyborne-backend",
      script: "dist/server.js",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "300M",
      env: {
        CLASS_REMINDER_PROCESS_IN_SERVER: "false",
        NODE_ENV: "production"
      }
    },
    {
      name: "email-worker",
      script: "dist/workers/emailWorker.js",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "200M"
    },
    {
      name: "invoice-worker",
      script: "dist/workers/invoiceEmailWorker.js",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "200M"
    },
    {
      name: "class-reminder-worker",
      script: "dist/workers/classReminderEmailWorker.js",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "200M"
    }
  ]
};
