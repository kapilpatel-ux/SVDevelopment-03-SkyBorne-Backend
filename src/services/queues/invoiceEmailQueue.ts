// src/services/queues/invoiceEmailQueue.ts
import Queue from "bull";

export interface InvoiceEmailJob {
  invoiceId: string;
  orderRef: string;
  userId: string;
  email: string;
  userName: string;
  plan: string;
  amount: number;
  currency: string;
  date: string; // Serialized as string for Bull queue
  subscriptionEndDate: string; // Serialized as string for Bull queue
  paymentMethod: string;
  taxRate?: number;
  invoicePDF: string; // Base64 encoded PDF string
}


export const invoiceEmailQueue = new Queue<InvoiceEmailJob>(
  "invoice-emails",
  process.env.REDIS_URL || "redis://127.0.0.1:6379",
  {
    redis: {
      tls: process.env.REDIS_URL?.startsWith("rediss://") ? {} : undefined,
      maxRetriesPerRequest: null,
    },
  }
);

// =====================
// QUEUE EVENT DEBUGGING
// =====================

invoiceEmailQueue.on("error", (err) => {
  console.error("❌ [INVOICE QUEUE ERROR] Redis connection failed:", err);
});

invoiceEmailQueue.on("waiting", (jobId) => {
  console.log("⏳ Invoice job waiting in queue:", jobId);
});

invoiceEmailQueue.on("active", (job) => {
  console.log("⚡ Invoice job started:", job.id);
});

invoiceEmailQueue.on("completed", (job, result) => {
  console.log("🎉 Invoice job completed:", job.id, "Result:", result);
});

invoiceEmailQueue.on("failed", (job, err) => {
  console.error("🔥 Invoice job failed:", job.id, err);
});

// ==========================
// FUNCTION TO ADD NEW JOB
// ==========================

export const addInvoiceEmailJob = async (
  jobData: Omit<InvoiceEmailJob, 'invoicePDF' | 'date' | 'subscriptionEndDate'> & {
    date: Date | string;
    subscriptionEndDate: Date | string;
  },
  invoicePDFBase64: string
) => {
  console.log("➡️ addInvoiceEmailJob called");

  try {
    const job = await invoiceEmailQueue.add(
      {
        ...jobData,
        date: jobData.date instanceof Date ? jobData.date.toISOString() : jobData.date,
        subscriptionEndDate: jobData.subscriptionEndDate instanceof Date 
          ? jobData.subscriptionEndDate.toISOString() 
          : jobData.subscriptionEndDate,
        invoicePDF: invoicePDFBase64, // Store as base64 string
      },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    return job;
  } catch (error) {
    console.error("❌ Error adding invoice job to queue:", error);
    throw error;
  }
};
