import Payment from "./models/Payment";
import Subscription from "./models/Subscription";

class NgeniusWebhookService {
  static async handleWebhook(data: any) {
    const orderRef = data?.order?.reference;
    const status = data?.event ?? "FAILED";

    const payment = await Payment.findOne({ orderRef });

    if (!payment) return;

    if (status === "SALE_SUCCESSFUL") {
      payment.status = "COMPLETED";
      payment.transactionId =
        data?.order?.id || data?.payment?.id || payment.transactionId;

      await Subscription.create({
        userId: payment.userId,
        planName: "Premium",
        renewalDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        status: "ACTIVE",
      });
    } else {
      payment.status = "FAILED";
    }

    payment.gatewayResponse = data;
    await payment.save();
  }
}

export default NgeniusWebhookService;
