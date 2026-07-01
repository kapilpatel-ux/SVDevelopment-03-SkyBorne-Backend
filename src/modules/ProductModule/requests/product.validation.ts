import * as yup from "yup";
import mongoose from "mongoose";

const objectIdCheck = (message: string) =>
  yup
    .string()
    .required(message)
    .test("is-objectid", message, (value) =>
      mongoose.Types.ObjectId.isValid(value)
    );

/**
 * CREATE PRODUCT
 */
export const CreateProductSchema = yup.object({
  body: yup.object({
    // name: yup.string().trim().required("Product name is required"),

    // sku: objectIdCheck("Invalid SKU (inventory) ID"),

    // category: objectIdCheck("Invalid category ID"),

    // price: yup
    //   .number()
    //   .typeError("Price must be a number")
    //   .min(0, "Price cannot be negative")
    //   .required("Price is required"),

    // stock: yup
      // .number()
      // .integer("Stock must be an integer")
      // .min(0, "Stock cannot be negative")
      // .optional(),

    // status: yup
    //   .string()
    //   .oneOf(["Published", "Draft"])
    //   .default("Draft"),

    // image: yup.string().trim().required("Image is required"),

    description: yup.string().trim().optional(),
  }),
});

/**
 * UPDATE PRODUCT (FULL / PARTIAL)
 */
export const UpdateProductSchema = yup.object({
  params: yup.object({
    productId: objectIdCheck("Invalid product ID"),
  }),

  body: yup.object({
    name: yup.string().trim().optional(),


    // category: yup
    //   .string()
    //   .test("is-objectid", "Invalid category ID", (value) =>
    //     value ? mongoose.Types.ObjectId.isValid(value) : true
    //   ),

    price: yup
      .number()
      .typeError("Price must be a number")
      .min(0, "Price cannot be negative")
      .optional(),

   

    status: yup.string().oneOf(["inactive", "active"]).optional(),

    image: yup.string().trim().optional(),

    description: yup.string().trim().optional(),
  }),
});

/**
 * UPDATE PRODUCT STATUS ONLY
 */
export const UpdateProductStatusSchema = yup.object({
  params: yup.object({
    productId: objectIdCheck("Invalid product ID"),
  }),

  body: yup.object({
    status: yup
      .string()
      .oneOf(["active", "inactive"])
      .required("Status is required"),
  }),
});
