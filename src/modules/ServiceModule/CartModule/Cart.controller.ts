import { Request, Response } from "express";
import mongoose from "mongoose";
import Cart from "./Cart.model";
import Product from "../../ProductModule/product.models";

export class CartController {
  /* ============================= */
  /* GET MY CART */
  /* ============================= */
  getMyCart = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const userId = req.user.id;

      const cart = await Cart.findOne({ userId }).lean();

      if (!cart) {
        return res.status(200).json({ success: true, data: { items: [], total: 0 } });
      }

      const total = cart.items.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );

      return res.status(200).json({ success: true, data: { ...cart, total } });
    } catch (error: any) {
      console.error("❌ [GetMyCart] Error:", error.message);
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  /* ============================= */
  /* ADD ITEM TO CART */
  /* ============================= */
  addToCart = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const userId = req.user.id;
      const { productId, quantity = 1 } = req.body;

      if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ success: false, message: "Valid productId is required" });
      }

      const qty = Number(quantity);
      if (!Number.isInteger(qty) || qty < 1) {
        return res.status(400).json({ success: false, message: "Quantity must be a positive integer" });
      }

      // Fetch product details
      const product = await Product.findById(productId).lean();
      if (!product) {
        return res.status(404).json({ success: false, message: "Product not found" });
      }
      if ((product as any).status !== "active") {
        return res.status(400).json({ success: false, message: "Product is not available" });
      }

      let cart = await Cart.findOne({ userId });

      if (!cart) {
        cart = await Cart.create({
          userId,
          items: [
            {
              product: new mongoose.Types.ObjectId(productId),
              name: product.name,
              price: product.price,
              quantity: qty,
              image: product.image ?? "",
            },
          ],
        });
      } else {
        const existingIndex = cart.items.findIndex(
          (i) => i.product.toString() === productId
        );

        if (existingIndex > -1) {
          cart.items[existingIndex].quantity += qty;
        } else {
          cart.items.push({
            product: new mongoose.Types.ObjectId(productId),
            name: product.name,
            price: product.price,
            quantity: qty,
            image: product.image ?? "",
          });
        }

        await cart.save();
      }

      const total = cart.items.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );

      console.log("✅ [AddToCart] Item added for user:", userId);

      return res.status(200).json({
        success: true,
        message: "Item added to cart",
        data: { ...cart.toObject(), total },
      });
    } catch (error: any) {
      console.error("❌ [AddToCart] Error:", error.message);
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  /* ============================= */
  /* UPDATE ITEM QUANTITY */
  /* ============================= */
  updateCartItem = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const userId = req.user.id;
      const { productId } = req.params;
      const { quantity } = req.body;

      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ success: false, message: "Invalid productId" });
      }

      const qty = Number(quantity);
      if (!Number.isInteger(qty) || qty < 1) {
        return res.status(400).json({ success: false, message: "Quantity must be at least 1" });
      }

      const cart = await Cart.findOne({ userId });
      if (!cart) {
        return res.status(404).json({ success: false, message: "Cart not found" });
      }

      const itemIndex = cart.items.findIndex(
        (i) => i.product.toString() === productId
      );

      if (itemIndex === -1) {
        return res.status(404).json({ success: false, message: "Item not found in cart" });
      }

      cart.items[itemIndex].quantity = qty;
      await cart.save();

      const total = cart.items.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );

      console.log("✅ [UpdateCartItem] Quantity updated for product:", productId);

      return res.status(200).json({
        success: true,
        message: "Cart updated",
        data: { ...cart.toObject(), total },
      });
    } catch (error: any) {
      console.error("❌ [UpdateCartItem] Error:", error.message);
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  /* ============================= */
  /* REMOVE ITEM FROM CART */
  /* ============================= */
  removeFromCart = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const userId = req.user.id;
      const { productId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ success: false, message: "Invalid productId" });
      }

      const cart = await Cart.findOne({ userId });
      if (!cart) {
        return res.status(404).json({ success: false, message: "Cart not found" });
      }

      const prevLength = cart.items.length;
      cart.items = cart.items.filter(
        (i) => i.product.toString() !== productId
      );

      if (cart.items.length === prevLength) {
        return res.status(404).json({ success: false, message: "Item not found in cart" });
      }

      await cart.save();

      const total = cart.items.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );

      console.log("✅ [RemoveFromCart] Item removed for product:", productId);

      return res.status(200).json({
        success: true,
        message: "Item removed from cart",
        data: { ...cart.toObject(), total },
      });
    } catch (error: any) {
      console.error("❌ [RemoveFromCart] Error:", error.message);
      return res.status(500).json({ success: false, message: error.message });
    }
  };

  /* ============================= */
  /* CLEAR CART */
  /* ============================= */
  clearCart = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const userId = req.user.id;

      await Cart.findOneAndUpdate({ userId }, { items: [] });

      console.log("✅ [ClearCart] Cart cleared for user:", userId);

      return res.status(200).json({
        success: true,
        message: "Cart cleared",
        data: { items: [], total: 0 },
      });
    } catch (error: any) {
      console.error("❌ [ClearCart] Error:", error.message);
      return res.status(500).json({ success: false, message: error.message });
    }
  };
}