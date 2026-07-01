import { AdminRoutes } from "../modules/AdminModule/admin.route";
import { CancelSubscriptionRoute } from "../modules/CancelSubscriptionModule/CancelSubscriptionRoute";
import { ConsultationRoute } from "../modules/ConsultationModule/ConsultationRoute";
import { CountryRoute } from "../modules/CountryModule/country.route";
import { FAQRoute } from "../modules/FAQModule/FAQRoute";
import { FeedbackRoute } from "../modules/FeedbackModule/FeedbackRoute";
import { InvoiceRoutes } from "../modules/InvoiceModule/InvoiceRoute";
import { MeetingRoute } from "../modules/MeetingModule/MeetingRoute";
import { MailRoutes } from "../modules/MailModule/MailRoute";
import { NewsLetterRoute } from "../modules/NewsLetterModule.ts/NewsLetterRoute";
import { PaymentApiRoutes } from "../modules/PaymentModule/routes/paymentRoutes";
import { PlanRoute } from "../modules/PlanModule/routes/PlanRoutes";
import { RegionRoute } from "../modules/RegionModule/region.routes";
import { ServiceRoute } from "../modules/ServiceModule/routes/ServiceRoute";
import { TestimonialRoute } from "../modules/TestimonialModule/routes/TestimonialRoute";
import { TrainerRoute } from "../modules/TrainerModule/TrainerRoute";
import { UserRoute } from "../modules/UserModule/UserRoute";
import { ProductRoute } from "../modules/ProductModule/product.route";
import { ProductInterestRoute } from "../modules/ProductInterestModule/productInterest.route";
import { EcomCategoryRoute } from "../modules/EcomCategoryModule/ecomCategory.route";
import { CustomerRoute } from "../modules/CustomerModule/customer.route";
import { OrderRoute } from "../modules/OrderModule/order.routes";
import { CartRoute } from "../modules/ServiceModule/CartModule/Cart.route";
import { EcomPaymentRoute } from "../modules/EcomPaymentModule/EcomPayment.route";
import { NotificationRoute } from "../modules/NotificationModule/notification.route";
import { ShopDashboardRoute } from "../modules/ShopDashboardModule/shopDashboard.route";
const appApiRoutes: any = [
  ...PaymentApiRoutes,
  ...ServiceRoute,
  ...PlanRoute,
  ...TestimonialRoute,
  ...FAQRoute,
  ...MeetingRoute,
  ...MailRoutes,
  ...ConsultationRoute,
  ...NewsLetterRoute,
  ...TrainerRoute,
  ...UserRoute,
  ...CountryRoute,
  ...AdminRoutes,
  ...RegionRoute,
  ...FeedbackRoute,
  ...CancelSubscriptionRoute,
  ...InvoiceRoutes,
  ...ProductRoute,
  ...ProductInterestRoute,
  ...EcomCategoryRoute,
  ...CustomerRoute,
  ...OrderRoute,
  ...CartRoute,
  ...EcomPaymentRoute,
  ...ShopDashboardRoute,
  ...NotificationRoute,

];

export default appApiRoutes;
