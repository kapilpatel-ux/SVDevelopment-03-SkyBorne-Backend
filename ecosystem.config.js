module.exports = {
  apps: [
    {
      name: "skyborne-backend",
      script: "dist/server.js",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_memory_restart: "300M"
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
    }
  ]
};
