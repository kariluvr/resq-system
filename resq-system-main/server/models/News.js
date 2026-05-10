const mongoose = require("mongoose");

const NewsSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  imageUrl: { type: String, default: "" },
  category: {
    type: String,
    enum: ["Emergency", "Weather", "Advisory", "Missing Person", "Disaster Alert", "General News"],
    default: "General News",
    index: true
  },
  priority: {
    type: String,
    enum: ["Low", "Moderate", "High", "Emergency"],
    default: "Low",
    index: true
  },
  createdBy: { type: String, default: "Admin User" },
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now },
  publishedAt: { type: Date, default: Date.now, index: true },
  archived: { type: Boolean, default: false, index: true },
  views: { type: Number, default: 0 },
  targetAudience: { type: String, default: "All residents" },
  pinned: { type: Boolean, default: false, index: true },
  notification: {
    type: {
      type: String,
      enum: ["emergency_alert", "disaster_warning", "advisory", "general"],
      default: "general"
    },
    channel: { type: String, default: "in_app" },
    fcmReady: { type: Boolean, default: true },
    payload: mongoose.Schema.Types.Mixed,
    preparedAt: String
  },
  sms: {
    attempted: { type: Boolean, default: false },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    provider: { type: String, default: "" },
    lastError: { type: String, default: "" }
  }
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

NewsSchema.pre("save", function updateTimestamp(next) {
  this.updatedAt = new Date();
  next();
});

NewsSchema.index({ title: "text", message: "text", category: "text" });
NewsSchema.index({ pinned: -1, publishedAt: -1 });

module.exports = mongoose.model("News", NewsSchema);
