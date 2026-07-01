import dotenv from "dotenv";
dotenv.config();

import { emailQueue } from "../services/queues/emailQueue";
import sgMail from "@sendgrid/mail";
import { initConsoleErrorLogger } from "../utils/consoleLogger";



initConsoleErrorLogger();

sgMail.setApiKey(process.env.SENDGRID_API_KEY!);

const getWelcomeEmailHTML = (firstName: string, plan: string): string => {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #f5f5f5;
            line-height: 1.6;
            color: #333;
        }
        
        .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            overflow: hidden;
        }
        
        .header {
            position: relative;
            height: 350px;
            overflow: hidden;
            background: linear-gradient(135deg, #c94a7f 0%, #d97fa0 100%);
            background-image: url('https://images.pexels.com/photos/917732/pexels-photo-917732.jpeg?auto=compress&cs=tinysrgb&w=1200&h=800&fit=crop');
            background-size: cover;
            background-position: center;
        }
        
        .header-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.25);
        }
        
        .content {
            padding: 40px 30px;
            text-align: center;
        }
        
        .content h1 {
            color: #c94a7f;
            font-size: 32px;
            font-weight: 700;
            margin-bottom: 20px;
            letter-spacing: 1px;
        }
        
        .welcome-text {
            font-size: 16px;
            color: #555;
            margin-bottom: 15px;
            line-height: 1.8;
        }
        
        .plan-text {
            font-size: 15px;
            color: #777;
            margin-bottom: 35px;
            font-style: italic;
        }
        
        .cta-section {
            display: flex;
            flex-direction: row;
            gap: 20px;
            margin: 30px -30px;
            padding: 30px;
            justify-content: center;
            background-color: #f9f9f9;
        }
        
        .cta-button {
            display: inline-block;
            padding: 14px 32px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            font-size: 15px;
            transition: all 0.3s ease;
            cursor: pointer;
            border: none;
        }
        
        .cta-button.primary {
            background-color: #c94a7f;
            color: #ffffff;
        }
        
        .cta-button.primary:hover {
            background-color: #b03a6f;
        }
        
        .cta-button.secondary {
            background-color: #ffffff;
            color: #c94a7f;
            border: 2px solid #c94a7f;
        }
        
        .cta-button.secondary:hover {
            background-color: #f8f8f8;
        }
        
        .divider {
            height: 1px;
            background-color: #e0e0e0;
            margin: 30px 0;
        }
        
        .footer {
            background-color: #fafafa;
            padding: 25px 30px;
            border-top: 1px solid #e0e0e0;
            text-align: center;
            font-size: 13px;
            color: #999;
        }
        
        .footer a {
            color: #c94a7f;
            text-decoration: none;
        }
        
        .footer p {
            margin: 5px 0;
        }
        
        @media (max-width: 600px) {
            .content {
                padding: 30px 20px;
            }
            
            .content h1 {
                font-size: 26px;
            }
            
            .cta-button {
                padding: 12px 24px;
                font-size: 14px;
            }
            
            .cta-section {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Header Section -->
        <div class="header">
            <div class="header-overlay"></div>
        </div>
        
        <!-- Main Content Section -->
        <div class="content">
            <h1>WELCOME TO SKYBORNE!</h1>
            
            <p class="welcome-text">
                Thank you <strong>${firstName}</strong>, for joining our program. We're thrilled to have you as a member!
            </p>
            
            <p class="plan-text">
                Your <strong>${plan}</strong> plan is now active and ready to use!
            </p>
            
            <!-- Call to Action Buttons -->
            <div class="cta-section">
                <a href="${process.env.DASHBOARD_URL}" class="cta-button primary" style="background-color: #c94a7f; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; display: inline-block;">
                    Go to Dashboard
                </a>
                <a href="${process.env.WEBSITE_URL}" class="cta-button secondary" style="background-color: #ffffff; color: #c94a7f; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; border: 2px solid #c94a7f; display: inline-block;margin-left:10px">
                    Explore Website
                </a>
            </div>
            
            <div class="divider"></div>
            
            <p class="welcome-text" style="font-size: 14px; color: #777;">
                If you have any questions or need assistance getting started, our support team is here to help.
            </p>
        </div>
        
        <!-- Footer Section -->
        <div class="footer">
            <p>© 2025 SKYBORNE. All rights reserved.</p>
            <p style="margin-top: 10px; color: #ccc; font-size: 12px;">
                This email was sent to you because you registered with SKYBORNE.
            </p>
        </div>
    </div>
</body>
</html>
  `;
};

emailQueue.process(async (job) => {

  const { email, firstName, plan } = job.data;

  const formattedPlan =
    plan?.charAt(0).toUpperCase() + plan?.slice(1);

  try {
    const htmlContent = getWelcomeEmailHTML(firstName, formattedPlan);

    const msg = {
      to: email,
      from: process.env.SENDGRID_FROM_EMAIL as string,
      subject: `Welcome to SKYBORNE, ${firstName}!`,
      html: htmlContent,
    };

    const response = await sgMail.send(msg);

    return { success: true };
  } catch (err: any) {
    console.error(`❌ Email send failed for ${email}`);
    console.error("Error Message:", err.message);

    // PRINT FULL RESPONSE BODY
    if (err.response?.body) {
      console.error(
        "🔍 SendGrid Error Body:",
        JSON.stringify(err.response.body, null, 2)
      );
    } else {
      console.error("⚠️ No SendGrid body returned");
    }

    const errors = err.response?.body?.errors;
    if (errors && errors.length > 0) {
      console.error("🔥 EXACT SENDGRID ERROR:", errors[0].message);
      console.error("📌 FIELD:", errors[0].field);
      console.error("ℹ HELP:", errors[0].help);
    }

    throw err;
  }

});

emailQueue.on("completed", (job) =>
  console.log(`🎉 Email job ${job.id} completed`)
);

emailQueue.on("failed", (job, err) =>
  console.error(`🔥 Email job ${job.id} failed: ${err.message}`)
);
