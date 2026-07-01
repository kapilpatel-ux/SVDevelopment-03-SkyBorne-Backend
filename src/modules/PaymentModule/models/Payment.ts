// modules/PaymentModule/models/Payment.ts

import mongoose, { Schema, Document } from 'mongoose';

interface IPayment extends Document {
userId: mongoose.Types.ObjectId;
orderRef: string;
reference?: string;
amount: number;
source?:string;
localAmount: number;
localCurrency?: string;
billingType?: string;
subscriptionActivated?: true;
plan: string;
currency: string;
status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
gateway: 'ngenius' | 'stripe';

// nGenius specific
ngeniusStatus?: string;
paymentLink?: string;


// Stripe specific
paymentIntentId?: string;
subscriptionId?: string;
transactionId?: string;
previousSubscriptionId?: string;
previousSubscriptionCancelledAt?: Date;

// Common fields
invoiceId?: string;
gatewayResponse?: Record<string, any>;
isRecurring: boolean;
recurringCycle?: string;
billingAttempt: number;
verifiedAt?: Date;
createdAt: Date;
updatedAt: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    orderRef: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
       // ✅ NEW FIELD: Prevents double subscription activation
    subscriptionActivated: {
      type: Boolean,
      default: false,
      index: true, // Add index for faster queries
    },
    reference: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    localAmount: {
      type: Number,
    },
    localCurrency: {
      type: String,
      uppercase: true,
      sparse: true,
    },
    plan: {
      type: String,
      required: true,
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED'],
      default: 'PENDING',
      index: true,
    },
    gateway: {
      type: String,
      enum: ['ngenius', 'stripe'],
      required: false,
      index: true,
    },
    source: {
      type: String,
      required: false,
    },

  // nGenius specific
  ngeniusStatus: {
    type: String,
    sparse: true,
  },
  paymentLink: {
    type: String,
    sparse: true,
  },

  // Stripe specific
  paymentIntentId: {
    type: String,
    unique: false,
    sparse: true,
    index: true,
  },
  subscriptionId: {
    type: String,
    unique: false,
  },
  transactionId: {
    type: String,
    sparse: true,
    index: true,
  },
  previousSubscriptionId: {
    type: String,
    sparse: true,
  },
  previousSubscriptionCancelledAt: {
    type: Date,
    sparse: true,
  },

  // Common fields
  invoiceId: {
    type: String,
    sparse: true,
  },
  gatewayResponse: {
    type: mongoose.Schema.Types.Mixed,
  },

  // Recurring payment fields
  isRecurring: {
    type: Boolean,
    default: true,
    index: true,
  },
  recurringCycle: {
    type: String, // Format: "YYYY-MM"
    sparse: true,
    index: true,
  },
  billingType: {
    type: String,
    enum: ['monthly', 'yearly'],
    default: 'monthly',
  },
  billingAttempt: {
    type: Number,
    default: 1,
  },
  verifiedAt: {
    type: Date,
    sparse: true,
  },
},
{
  timestamps: true,
}
);



export default mongoose.model<IPayment>('Payment', PaymentSchema);
