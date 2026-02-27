class CreditScoreCalculator {
    constructor(models) {
        this.Transaction = models.Transactions;
        
        // --- SCORING THRESHOLDS (Adjust for your economy) ---
        this.TARGET_VOLUME = 1000000; // $1,000,000 processed = Max Volume Score
        this.TARGET_COUNT = 1000;     // 1000 Transactions = Max Activity Score
        this.TARGET_AGE_DAYS = 365; // 1 Year = Max Longevity Score
    }

    /**
     * Calculate Credit Score (0 - 100)
     * Uses MongoDB Aggregation for O(1) App Performance
     */
    async calculate(userId) {
        // 1. GET RAW METRICS (Database Side Calculation)
        const metrics = await this.Transaction.aggregate([
            { $match: { user_id: userId } },
            { 
                $group: {
                    _id: "$user_id",
                    totalVolume: { $sum: "$amount" }, // Sum of all money moved
                    totalCount: { $count: {} },       // Total number of transactions
                    successCount: { 
                        $sum: { $cond: [{ $eq: ["$status", "succeeded"] }, 1, 0] } 
                    },
                    failCount: { 
                        $sum: { $cond: [{ $in: ["$status", ["failed", "declined"]] }, 1, 0] } 
                    },
                    firstTxn: { $min: "$created_at" }, // Oldest transaction timestamp
                    lastTxn: { $max: "$created_at" }   // Newest transaction
                }
            }
        ]);

        // 2. HANDLE NEW USERS (No History)
        if (!metrics || metrics.length === 0) {
            return {
                score: 10, // Baseline score for signing up
                rating: 'Unscored',
                breakdown: { volume: 0, consistency: 0, activity: 0, longevity: 0 }
            };
        }

        const data = metrics[0];
        
        // 3. CALCULATE PARTIAL SCORES

        // A. Consistency (Max 35): (Success / Total) * 35
        // If 100% success, they get 35 points.
        const successRate = data.totalCount > 0 ? (data.successCount / data.totalCount) : 0;
        const scoreConsistency = Math.round(successRate * 35);

        // B. Volume (Max 30): Logarithmic Curve
        // We use Math.min so they don't exceed 30 points even if they move $1M
        const volumeRatio = Math.min(data.totalVolume / this.TARGET_VOLUME, 1);
        const scoreVolume = Math.round(volumeRatio * 30);

        // C. Activity (Max 20): Linear Cap
        const countRatio = Math.min(data.totalCount / this.TARGET_COUNT, 1);
        const scoreActivity = Math.round(countRatio * 20);

        // D. Longevity (Max 15): Days since first transaction
        const now = Date.now() / 1000; // Assuming DB stores seconds
        const ageInSeconds = now - data.firstTxn;
        const ageInDays = ageInSeconds / 86400;
        const ageRatio = Math.min(ageInDays / this.TARGET_AGE_DAYS, 1);
        const scoreLongevity = Math.round(ageRatio * 15);

        // 4. APPLY PENALTIES
        // Harsh penalty for failures to protect the lender
        const penalty = data.failCount * 2; // -2 points per failure

        // 5. FINAL CALCULATION
        let totalScore = (scoreConsistency + scoreVolume + scoreActivity + scoreLongevity) - penalty;
        
        // Clamp score between 0 and 100
        totalScore = Math.max(0, Math.min(100, totalScore));

        // 6. DETERMINE RATING LABEL
        let rating = 'Poor';
        if (totalScore >= 80) rating = 'Excellent';
        else if (totalScore >= 60) rating = 'Good';
        else if (totalScore >= 40) rating = 'Fair';

        return {
            score: totalScore,
            rating: rating,
            can_loan: totalScore >= 60, // Simple Loan Gate
            max_loan_amount: this._calculateLoanLimit(totalScore, data.totalVolume),
            breakdown: {
                consistency: scoreConsistency,
                volume: scoreVolume,
                activity: scoreActivity,
                longevity: scoreLongevity,
                penalty: penalty
            },
            stats: {
                volume: data.totalVolume,
                success_rate: (successRate * 100).toFixed(1) + '%'
            }
        };
    }

    /**
     * Internal: Calculate Dynamic Loan Limit based on Score
     * Better scores unlock higher percentages of their total volume
     */
    _calculateLoanLimit(score, totalVolume) {
        if (score < 40) return 0;

        // Multiplier: 
        // Score 40-60: 5% of volume
        // Score 60-80: 10% of volume
        // Score 80-100: 20% of volume
        let multiplier = 0.05;
        if (score >= 80) multiplier = 0.20;
        else if (score >= 60) multiplier = 0.10;

        // Cap the max loan to avoid risk (e.g., Max $5000 regardless of volume)
        const calculatedLimit = totalVolume * multiplier;
        return Math.min(calculatedLimit, 500); 
    }
}

module.exports = CreditScoreCalculator;