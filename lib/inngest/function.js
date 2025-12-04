import { db } from "@/lib/prisma";
import { inngest } from "./client";
import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export const generateIndustryInsights = inngest.createFunction(
  { name: "Generate Industry Insights" },
  { cron: "0 0 * * 0" }, // Run every Sunday at midnight
  async ({ event, step }) => {
    const industries = await step.run("Fetch industries", async () => {
      return await db.industryInsight.findMany({
        select: { industry: true },
      });
    });

    for (const { industry } of industries) {
      try {
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
          - Return ONLY valid JSON. No extra text, markdown, or comments.
          - Include at least 5 common roles for salary ranges.
          - "growthRate" should be a percentage number (e.g. 7.5).
          - Include at least 5 skills and 5 trends.
        `;

        // Call Groq through an Inngest step so it’s logged & retried
        const text = await step.run(
          `Generate ${industry} insights with Groq`,
          async () => {
            const completion = await groq.chat.completions.create({
              model: "llama-3.3-70b-versatile",
              temperature: 0.7,
              messages: [
                {
                  role: "system",
                  content:
                    "You are a labour market analyst. Always respond with VALID JSON only, matching the requested schema.",
                },
                { role: "user", content: prompt },
              ],
            });

            return completion.choices[0]?.message?.content || "";
          }
        );

        const cleanedText = text.replace(/```(?:json)?\n?|```/g, "").trim();
        const insights = JSON.parse(cleanedText);

        await step.run(`Update ${industry} insights`, async () => {
          await db.industryInsight.update({
            where: { industry },
            data: {
              ...insights,
              lastUpdated: new Date(),
              nextUpdate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
            },
          });
        });
      } catch (error) {
        console.error(`Error updating insights for ${industry}:`, error);
        // yahan optionally: continue; (loop waise bhi next pe chala jayega)
      }
    }
  }
);
