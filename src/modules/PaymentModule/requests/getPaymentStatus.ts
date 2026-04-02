import * as Yup from "yup";
import mongoose from "mongoose";

export const GetPaymentStatusSchema = Yup.object({
  params: Yup.object({
    orderRef: Yup.string()
      .required("orderRef is required")
      .matches(/^[A-Za-z0-9\-]+$/, "Invalid orderRef format"),
  }),
});

export const GetPaymentByIdSchema = Yup.object({
  params: Yup.object({
    id: Yup.string()
      .required("id is required")
      .test(
        "is-id-or-ref",
        "Invalid payment id",
        (value) =>
          mongoose.Types.ObjectId.isValid(value || "") ||
          /^[A-Za-z0-9\-]+$/.test(value || "")
      ),
  }),
});

export const GetVerifyStatusSchema = Yup.object({
  body: Yup.object({
    orderRef: Yup.string()
      .required("orderRef is required")
      .matches(/^[A-Za-z0-9\-]+$/, "Invalid orderRef format"),
    reference: Yup.string().required("reference is required"),
  }),
});
