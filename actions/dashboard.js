"use server";

import { db } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ---------- AI INSIGHTS (using Groq) ----------

export const generateAIInsights = async (industry) => {
  const prompt = `
    Analyze the current state of the ${industry} industry and provide insights in ONLY the following JSON format without any additional notes or explanations:
    {
      "salaryRanges": [
        { "role": "string", "min": number, "max": number, "median": number, "location": "string" }
      ],
      "growthRate": number,
      "demandLevel": "High" | "Medium" | "Low",
      "topSkills": ["skill1", "skill2"],
      "marketOutlook": "Positive" | "Neutral" | "Negative",
      "keyTrends": ["trend1", "trend2"],
      "recommendedSkills": ["skill1", "skill2"]
    }
    
    IMPORTANT:
    - Return ONLY valid JSON. No additional text, no markdown, no comments.
    - Include at least 5 common roles in "salaryRanges".
    - "growthRate" should be a percentage number (e.g. 8.5).
    - Include at least 5 items in "topSkills" and "keyTrends".
  `;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            "You are a data analyst assistant. Always respond with VALID JSON only, exactly matching the requested schema.",
        },
        { role: "user", content: prompt },
      ],
    });

    let text = completion.choices[0]?.message?.content || "";

    // Remove ```json ... ``` wrapper if model adds it
    const cleanedText = text.replace(/```(?:json)?\n?|```/g, "").trim();

    return JSON.parse(cleanedText);
  } catch (error) {
    console.error("Error generating AI insights:", error);
    throw new Error("Failed to generate AI insights");
  }
};

// ---------- GET INDUSTRY INSIGHTS ----------

export async function getIndustryInsights() {
  const { userId } = await auth();
  if (!userId) throw new Error("Unauthorized");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
    include: {
      industryInsight: true,
    },
  });

  if (!user) throw new Error("User not found");
  if (!user.industry) {
    throw new Error("User industry not set. Please complete onboarding first.");
  }

  // If no insights exist, generate them
  if (!user.industryInsight) {
    const insights = await generateAIInsights(user.industry);

    const industryInsight = await db.industryInsight.create({
      data: {
        industry: user.industry,
        ...insights,
        nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    return industryInsight;
  }

  return user.industryInsight;
}
