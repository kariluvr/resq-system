const mongoose = require("mongoose");

const ReportSchema = new mongoose.Schema({
  legacyId: Number,
  externalSource: String,
  externalId: String,
  type: { type: String, default: "OTHER" },
  title: { type: String, required: true },
  status: { type: String, default: "received" },
  priority: { type: String, default: "medium" },
  reporter: { type: String, required: true },
  reporterId: String,
  mobile: String,
  location: { type: String, required: true },
  coordinates: {
    lat: Number,
    lng: Number
  },
  description: { type: String, required: true },
  submittedAt: { type: String, default: () => new Date().toISOString() },
  evidence: [{
    kind: { type: String, default: "note" },
    label: String,
    url: String
  }],
  assignedTo: String,
  notes: [{
    text: String,
    at: String,
    by: String
  }],
  history: [{
    status: String,
    note: String,
    at: String,
    by: String
  }],
  dispatch: {
    unit: String,
    responder: String,
    etaMinutes: Number,
    lastUpdatedAt: String
  }
}, {
  versionKey: false,
  toJSON: {
    virtuals: true,
    transform(doc, ret) {
      ret.id = String(ret.legacyId || ret._id);
      delete ret._id;
      delete ret.legacyId;
      return ret;
    }
  }
});

ReportSchema.index({ externalSource: 1, externalId: 1 }, {
  unique: true,
  sparse: true
});

module.exports = mongoose.model("Report", ReportSchema);
