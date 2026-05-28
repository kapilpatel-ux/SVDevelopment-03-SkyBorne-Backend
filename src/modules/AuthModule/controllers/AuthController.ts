// ============================================
// src/modules/AuthModule/controllers/authController.ts
// ============================================
import { NextFunction, Request, Response } from "express";
import User from "../../UserModule/models/User";
import {
  UserRole,
  AuthProvider,
} from "../../UserModule/interface/userInterface";
import {
  generateTokens,
  verifyRefreshToken,
  verifyToken,
} from "../../../config/jwt";
import { OTPService } from "../../UserModule/services/otpService";
import { logAuthEvent, logger } from "../../../utils/winston.utils";
import { AuthService } from "../services/authService";
import TempUser from "../../UserModule/models/TempUser";
import extractPhoneDetails from "../../../utils/extractPhoneDetail";
import { request } from "http";
import { getName } from "country-list";
import { PushNotificationService } from "../../../services/pushNotification.service";
import { NotFoundError } from "../../../handlers/httpError.handler";

// Helper function for logging auth events

export class AuthController {
  static async signup(req: Request, res: Response, next: NextFunction) {
    try {
      const ip = req.ip || req.headers["x-forwarded-for"] || "unknown";
      const userAgent = req.headers["user-agent"] || "unknown";

      let payload: any = {};

      if (req?.body?.phoneNumber) {
        const { dialingCode, localNumber, countryCode, country } =
          extractPhoneDetails(req?.body?.phoneNumber);
        const countryFromRequest = String(req?.body?.country || "").trim();
        const requestedCountryCode =
          /^[a-z]{2}$/i.test(countryFromRequest)
            ? countryFromRequest.toUpperCase()
            : "";
        const requestedCountryName = countryFromRequest
          ? getName(requestedCountryCode || countryFromRequest) ||
            countryFromRequest
          : "";

        payload = {
          ...req.body,
          dialingCode,
          country: requestedCountryName || country,
          countryCode: requestedCountryCode || countryCode,
          localNumber,
          ip,
          userAgent,
        };
      } else {
        payload = {
          ...req.body,
          ip,
          userAgent,
        };
      }

      let result;

      if (payload.googleId) {
        result = await AuthService.googleSignup(payload);
      } else if (payload.appleId) {
        result = await AuthService.appleSignup(payload);
      } else {
        result = await AuthService.emailSignup(payload);
      }

      PushNotificationService.sendWelcome(
        String(result.user._id),
        String(result.user.firstName || "").trim() || undefined,
      ).catch((error: any) => {
        console.error("❌ Failed to send welcome push notification:", error?.message || error);
      });

      return res.status(201).json({
        success: true,
        message: "Account created successfully",
        data: {
          user: {
            id: result.user._id,
            firstName: result.user.firstName,
            lastName: result.user.lastName,
            email: result.user.email,
            country: result.user.country,
            state: result.user.state,
            city: result.user.city,
            countryCode: result.user.countryCode,
            role: result.user.role,
            motivation: result.user.motivation,
            onboardingCompleted: result.user.onboardingCompleted,
          },
          ...result.tokens,
        },
      });
    } catch (error: any) {
      logger.error("Signup error:", error.message);
      next(error);
    }
  }

  // Email/Password Login
  static async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;

      const ip = (req.ip ||
        req.headers["x-forwarded-for"] ||
        "unknown") as string;
      const userAgent = req.headers["user-agent"] || "unknown";

      const user = await User.findOne({ email }).select("+password");

      if (!user) {
        logAuthEvent({
          email,
          event: "login",
          success: false,
          ip,
          userAgent,
          error: "User not found",
        });

        return res.status(404).json({
          success: false,
          message: "Account not available",
        });
      }

      if (!user.password) {
        logAuthEvent({
          userId: user._id.toString(),
          email: user.email,
          event: "login",
          success: false,
          ip,
          userAgent,
          error: "No password set - OAuth user",
        });

        return res.status(400).json({
          success: false,
          message: "Please login with your social account",
        });
      }

      // Verify password
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        logAuthEvent({
          userId: user._id.toString(),
          email: user.email,
          event: "login",
          success: false,
          ip,
          userAgent,
          error: "Invalid password",
        });

        return res.status(401).json({
          success: false,
          message: "Invalid credentials",
        });
      }

      // Check if account is active
      if (!user.isActive) {
        logAuthEvent({
          userId: user._id.toString(),
          email: user.email,
          event: "login",
          success: false,
          ip,
          userAgent,
          error: "Account deactivated",
        });

        return res.status(403).json({
          success: false,
          message: "Account is deactivated",
        });
      }

      // Update last login
      user.lastLogin = new Date();
      await user.save();

      // Generate tokens
      const tokens = generateTokens(user);

      // Log successful login
      logAuthEvent({
        userId: user._id.toString(),
        email: user.email,
        event: "login",
        success: true,
        ip,
        userAgent,
      });

      res.status(200).json({
        success: true,
        message: "Login successful",
        data: {
          user: {
            id: user._id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            role: user.role,
            onboardingCompleted: user.onboardingCompleted,
          },
          ...tokens,
        },
      });
    } catch (error: any) {
      logger.error("Login error", error.message);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Social Login (Google / Apple)
  static async socialLogin(req: Request, res: Response) {
    try {
      const { provider, email, googleId, appleId } = req.body;

      if (!provider || !email) {
        return res.status(400).json({
          success: false,
          message: "Provider and email are required",
        });
      }

      const ip = (req.ip ||
        req.headers["x-forwarded-for"] ||
        "unknown") as string;
      const userAgent = req.headers["user-agent"] || "unknown";

      // User MUST already exist
      const user = await User.findOne({ email });

      if (!user) {
        logAuthEvent({
          email,
          event: "social_login",
          success: false,
          ip,
          userAgent,
          error: "User not found",
        });

        return res.status(404).json({
          success: false,
          message:
            "No account found. Please signup first with " +
            provider.toUpperCase(),
        });
      }

      // Check if same provider is used
      if (provider !== user.authProvider) {
        logAuthEvent({
          userId: user._id.toString(),
          email,
          event: "social_login",
          success: false,
          ip,
          userAgent,
          error: "Invalid provider",
        });

        return res.status(400).json({
          success: false,
          message: `Please login using your ${user.authProvider} account`,
        });
      }

      // Check provider IDs
      if (provider === "google" && user.googleId !== googleId) {
        return res.status(400).json({
          success: false,
          message: "Google account mismatch",
        });
      }

      if (provider === "apple" && user.appleId !== appleId) {
        return res.status(400).json({
          success: false,
          message: "Apple account mismatch",
        });
      }

      // Check if account is active
      if (!user.isActive) {
        return res.status(403).json({
          success: false,
          message: "Account is deactivated",
        });
      }

      // Update login timestamp
      user.lastLogin = new Date();
      await user.save();

      // Generate tokens
      const tokens = generateTokens(user);

      // Log event
      logAuthEvent({
        userId: user._id.toString(),
        email,
        event: "social_login",
        success: true,
        ip,
        userAgent,
      });

      return res.status(200).json({
        success: true,
        message: "Login successful",
        data: {
          user: {
            id: user._id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            role: user.role,
            onboardingCompleted: user.onboardingCompleted,
          },
          ...tokens,
        },
      });
    } catch (error: any) {
      logger.error("Social login error", error.message);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Step 3: Send OTP
  static async sendOTP(req: Request, res: Response) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email is required",
        });
      }

      let tempUser = await TempUser.findOne({ email });

      // 1️⃣ Create temp user if not exists
      if (!tempUser) {
        tempUser = await TempUser.create({
          message: "Account not available",
          otpVerified: false,
        });
      }

      // 2️⃣ Generate & store OTP in redis
      const otp = await OTPService.generateAndStoreOTP(email);

      // 3️⃣ Send email OTP
      await OTPService.sendEmailOTP(email, otp);

      return res.status(200).json({
        success: true,
        message: "OTP sent",
        data: {
          tempUserId: tempUser._id,
          expiresIn: 600,
        },
      });
    } catch (err: unknown) {
      if (err instanceof Error) {
        return res.status(500).json({ success: false, message: err.message });
      }

      return res
        .status(500)
        .json({ success: false, message: "Unknown error occurred" });
    }
  }

  // Step 4: Verify OTP (Email Version)
  static async verifyOTP(req: Request, res: Response) {
    try {
      const { email, otp } = req.body;

      // 1️⃣ Validate OTP via Redis
      const valid = await OTPService.verifyOTP(email, otp);

      if (!valid) {
        return res.status(400).json({
          success: false,
          message: "Invalid or expired OTP",
        });
      }

      // 2️⃣ Update temporary user
      const tempUser = await TempUser.findOne({ email });

      if (!tempUser) {
        return res.status(404).json({
          success: false,
          message: "Temporary session not found",
        });
      }

      tempUser.otpVerified = true;
      await tempUser.save();

      return res.status(200).json({
        success: true,
        message: "OTP verified",
        data: {
          tempUserId: tempUser._id,
          otpVerified: true,
        },
      });
    } catch (err: unknown) {
      if (err instanceof Error) {
        return res.status(500).json({ success: false, message: err.message });
      }

      return res
        .status(500)
        .json({ success: false, message: "Unknown error occurred" });
    }
  }

  // Resend OTP
  // Resend OTP (Email Version)
  static async resendOTP(req: Request, res: Response) {
    try {
      const { email } = req.body;
      const userId = (req as any).user?.id;

      const ip = (req.ip ||
        req.headers["x-forwarded-for"] ||
        "unknown") as string;
      const userAgent = req.headers["user-agent"] || "unknown";

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized",
        });
      }

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email is required",
        });
      }

      // Rate limiting
      const remainingTime = await OTPService.getOTPRemainingTime(email);
      if (remainingTime > 570) {
        // 600 - 570 = 30 seconds
        return res.status(429).json({
          success: false,
          message: "Please wait 30 seconds before resending OTP",
          data: {
            retryAfter: remainingTime - 570,
          },
        });
      }

      // Resend OTP
      const otp = await OTPService.resendOTP(email);

      const user = await User.findById(userId);
      if (user) {
        logAuthEvent({
          userId: user._id.toString(),
          email: user.email,
          event: "otp_sent",
          success: true,
          ip,
          userAgent,
        });
      }

      return res.status(200).json({
        success: true,
        message: "OTP resent successfully",
        data: {
          email: email.replace(/(.{2}).+(@.+)/, "$1****$2"), // masking
          expiresIn: 600,
        },
      });
    } catch (error: any) {
      logger.error("Resend OTP error", error.message);
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  static async refreshAccessToken(req: Request, res: Response) {
    const { refreshToken } = req.body;

    const decoded = verifyRefreshToken(refreshToken);

    const { accessToken, refreshToken: newRefreshToken } = generateTokens({
      _id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    });

    return res.json({
      success: true,
      accessToken,
      refreshToken: newRefreshToken,
    });
  }

  static async requestPasswordReset(req: Request, res: Response) {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      throw new NotFoundError("No account found with this email");
    }

    PushNotificationService.sendPasswordResetRequested(String(user._id)).catch(
      (error: any) => {
        console.error("❌ Failed to send password-reset-requested push notification:", error?.message || error);
      },
    );

    let tempUser = await TempUser.findOne({ email });

    if (!tempUser) {
      tempUser = await TempUser.create({
        email,
        otpVerified: false,
      });
    }

    const otp = await OTPService.generateAndStoreOTP(email);
    await OTPService.sendEmailOTP(email, otp);

    return res.status(200).json({
      success: true,
      message: "OTP sent for password reset",
      data: {
        tempUserId: tempUser._id,
        expiresIn: 600,
      },
    });
  }

  static async verifyPasswordResetOTP(req: Request, res: Response) {
    const { email, otp } = req.body;

    const valid = await OTPService.verifyOTP(email, otp);

    if (!valid) {
      throw new Error("Invalid or expired OTP");
    }

    const tempUser = await TempUser.findOne({ email });

    if (!tempUser) {
      throw new Error("Temporary session not found");
    }

    tempUser.otpVerified = true;
    await tempUser.save();

    return res.status(200).json({
      success: true,
      message: "OTP verified",
      data: {
        tempUserId: tempUser._id,
      },
    });
  }

  static async resetPassword(req: Request, res: Response) {
    const { email, newPassword } = req.body;

    const tempUser = await TempUser.findOne({ email });
    if (!tempUser?.otpVerified) {
      throw new Error("OTP not verified");
    }

    const user = await User.findOne({ email });
    if (!user) throw new Error("User not found");

    user.password = newPassword;
    await user.save();

    PushNotificationService.sendPasswordChanged(String(user._id)).catch((error: any) => {
      console.error("❌ Failed to send password-changed push notification:", error?.message || error);
    });

    await TempUser.deleteOne({ email });

    return res.status(200).json({
      success: true,
      message: "Password reset successfully",
    });
  }
}
