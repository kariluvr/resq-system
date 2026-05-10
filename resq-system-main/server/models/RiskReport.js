const mongoose = require("mongoose");

const RiskReportSchema = new mongoose.Schema({
  barangay: { type: String, required: true, index: true },
  riskLevel: { 
    type: String, 
    enum: ["HIGH", "MODERATE", "LOW", "UNKNOWN"], 
    required: true,
    index: true
  },
  riskScore: { type: Number, required: true },
  weatherData: {
    rainfall: { type: Number, default: 0 },
    humidity: { type: Number, default: 0 },
    windSpeed: { type: Number, default: 0 },
    temperature: { type: Number, default: 0 }
  },
  trend: { type: String, default: "stable" },
  dataPoints: { type: Number, default: 0 },
  recommendations: [{ type: String }],
  calculatedAt: { type: Date, default: Date.now, index: true }
}, {
  versionKey: false,
  toJSON: {
    virtuals: true,
    transform(doc, ret) {
      ret.id = ret._id.toString();
      delete ret._id;
      return ret;
    }
  }
});

// Compound index for efficient queries
RiskReportSchema.index({ barangay: 1, calculatedAt: -1 });

module.exports = mongoose.model("RiskReport", RiskReportSchema);