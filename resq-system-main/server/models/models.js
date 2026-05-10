const mongoose = require("mongoose");

function legacyTransform(doc, ret) {
  ret.id = ret.legacyId || ret._id.toString();
  delete ret._id;
  delete ret.legacyId;
  delete ret.password;
  return ret;
}

const AdminSchema = new mongoose.Schema({
  legacyId: Number,
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  username: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["admin"], default: "admin" }
}, {
  versionKey: false,
  toJSON: { virtuals: true, transform: legacyTransform }
});

const ResidentSchema = new mongoose.Schema({
  legacyId: Number,
  fullName: { type: String, required: true },
  mobile: String,
  submittedId: String,
  registeredAt: String,
  status: { type: String, default: "pending" },
  address: String,
  decisions: [{
    status: String,
    note: String,
    at: String,
    by: String
  }]
}, {
  versionKey: false,
  toJSON: { virtuals: true, transform: legacyTransform }
});

const AppSettingsSchema = new mongoose.Schema({
  key: { type: String, default: "main", unique: true },
  moderation: {
    keywords: [String],
    threshold: { type: Number, default: 5 }
  },
  reasons: {
    approval: [String],
    rejection: [String]
  },
  barangays: [{
    id: Number,
    name: String,
    district: String,
    status: { type: String, default: "active" },
    residents: { type: Number, default: 0 }
  }]
}, {
  versionKey: false
});

const AuditLogSchema = new mongoose.Schema({
  action: String,
  target: String,
  details: mongoose.Schema.Types.Mixed,
  at: { type: String, default: () => new Date().toISOString() },
  by: String
}, {
  versionKey: false
});

const NotificationSchema = new mongoose.Schema({
  title: String,
  message: String,
  kind: { type: String, default: "info" },
  read: { type: Boolean, default: false },
  refType: String,
  refId: String,
  at: { type: String, default: () => new Date().toISOString() }
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

module.exports = {
  Admin: mongoose.model("Admin", AdminSchema),
  Resident: mongoose.model("Resident", ResidentSchema),
  AppSettings: mongoose.model("AppSettings", AppSettingsSchema),
  AuditLog: mongoose.model("AuditLog", AuditLogSchema),
  Notification: mongoose.model("Notification", NotificationSchema)
};
