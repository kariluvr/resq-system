# Barangay Risk Report System

## Overview

The Risk Report system is a comprehensive disaster risk assessment tool that analyzes weather data from Supabase to determine the risk level for specific barangays. It uses an enhanced ML algorithm to calculate risk scores based on multiple weather factors.

## Features

### ✅ Current Features
- **Dynamic Barangay Selection**: Loads active barangays from the database settings
- **Real-time Risk Assessment**: Calculates risk levels based on current weather conditions
- **Enhanced ML Algorithm**: Weighted risk calculation considering:
  - Rainfall (highest priority - critical for flooding/landslides)
  - Humidity (contributes to storm formation)
  - Wind speed (critical for storm damage)
  - Temperature extremes (can exacerbate conditions)
  - Trend analysis (comparing with previous data points)
- **Risk History**: View past risk assessments for any barangay
- **Automatic Report Saving**: All risk reports are saved to MongoDB for historical tracking
- **Smart Recommendations**: Context-aware safety recommendations based on risk level

### 🆕 New Features
- **Risk Score Display**: Shows numerical risk score (0-12+) for precise assessment
- **History Button**: View last 10 risk assessments for selected barangay
- **Better Error Handling**: Graceful fallbacks when data is unavailable
- **Improved UI**: Enhanced styling and user experience

## System Architecture

```
Frontend (HTML/JS/CSS)
    ↓
Node.js API Server (server/index.js)
    ↓
Python ML API (server/ml_api.py)
    ↓
Supabase (weather_data table)
    ↓
MongoDB (RiskReport collection)
```

## Risk Calculation Algorithm

### Risk Score Components

| Factor | Weight | Thresholds |
|--------|--------|------------|
| **Rainfall** | Up to 4.0 | ≥15mm (+4), ≥10mm (+3), ≥6mm (+2), ≥3mm (+1) |
| **Humidity** | Up to 2.0 | ≥95% (+2), ≥90% (+1.5), ≥85% (+1), ≥80% (+0.5) |
| **Wind Speed** | Up to 3.0 | ≥60km/h (+3), ≥50km/h (+2), ≥30km/h (+1) |
| **Temperature** | Up to 1.5 | >38°C or <5°C (+1.5), >35°C or <10°C (+0.5) |
| **Trend Analysis** | Up to 1.8 | Rapid rainfall increase (+1), moderate increase (+0.5), wind increase (+0.5), humidity increase (+0.3) |

### Risk Levels

- **HIGH** (Score ≥ 7.0): Immediate action required
- **MODERATE** (Score ≥ 4.0): Stay alert and prepared
- **LOW** (Score < 4.0): Normal activities can continue
- **UNKNOWN**: No data available

## API Endpoints

### 1. Get Risk Report
```
GET /api/risk-report/:barangay
```
Fetches real-time risk assessment for a specific barangay.

**Response:**
```json
{
  "barangay": "Mamburao",
  "risk_level": "HIGH",
  "risk_score": 7.5,
  "rainfall": 12.5,
  "humidity": 92,
  "wind_speed": 45,
  "temperature": 28,
  "trend": "increasing",
  "data_points": 15,
  "last_updated": "2026-05-06T06:00:00.000Z",
  "recommendations": [
    "Evacuate low-lying areas immediately",
    "Prepare emergency kits and supplies",
    ...
  ]
}
```

### 2. Save Risk Report
```
POST /api/risk-report
```
Saves a risk report to the database for historical tracking.

**Request Body:**
```json
{
  "barangay": "Mamburao",
  "risk_level": "HIGH",
  "risk_score": 7.5,
  "rainfall": 12.5,
  "humidity": 92,
  "wind_speed": 45,
  "temperature": 28,
  "trend": "increasing",
  "data_points": 15,
  "recommendations": [...]
}
```

### 3. Get Risk History
```
GET /api/risk-report/history/:barangay?limit=10
```
Retrieves the last N risk reports for a specific barangay.

### 4. Get Latest Report
```
GET /api/risk-report/latest/:barangay
```
Gets the most recent risk report for a barangay.

### 5. Get Risk Summary
```
GET /api/risk-report/summary
```
Provides an overview of risk levels across all barangays.

## Database Schema

### MongoDB RiskReport Collection

```javascript
{
  _id: ObjectId,
  barangay: String,           // Name of the barangay
  riskLevel: String,          // HIGH, MODERATE, LOW, UNKNOWN
  riskScore: Number,          // 0-12+
  weatherData: {
    rainfall: Number,         // mm
    humidity: Number,         // %
    windSpeed: Number,        // km/h
    temperature: Number       // °C
  },
  trend: String,              // increasing, decreasing, stable
  dataPoints: Number,         // Number of weather data points used
  recommendations: [String],  // Safety recommendations
  calculatedAt: Date          // Timestamp
}
```

### Supabase weather_data Table

Expected columns:
- `id`: Primary key
- `city`: Barangay name
- `rainfall`: Rainfall in mm
- `humidity`: Humidity percentage
- `wind_speed`: Wind speed in km/h
- `temperature`: Temperature in °C
- `timestamp`: Data collection timestamp

## Setup and Configuration

### Prerequisites
1. Node.js server running on port 5000
2. Python ML API running on port 8000
3. MongoDB connection configured
4. Supabase project with weather_data table

### Environment Variables

**.env file (server/)**
```env
PORT=5000
MONGO_URI=mongodb://...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-supabase-key
```

### Running the System

1. **Start MongoDB** (if not using MongoDB Atlas)
2. **Start Node.js Server**:
   ```bash
   cd server
   npm install
   npm start
   ```
3. **Start Python ML API**:
   ```bash
   cd server
   pip install fastapi uvicorn supabase python-dotenv
   uvicorn ml_api:app --reload --port 8000
   ```
4. **Access the Risk Report Page**:
   - Navigate to: `http://localhost:5000/RISK%20REPORT/riskreport.html`
   - Log in with admin credentials

## Usage Guide

### For Administrators

1. **Login** to the admin dashboard
2. **Navigate** to Risk Report page
3. **Select** a barangay from the dropdown
4. **Click** "Run Risk Assessment" to get current risk level
5. **View** detailed weather data and recommendations
6. **Click** "View History" to see past assessments

### Adding New Barangays

1. Go to Settings page
2. Add new barangay with name and district
3. The new barangay will automatically appear in the Risk Report dropdown

### Interpreting Results

- **Risk Score 7.0+**: Take immediate action, consider evacuation
- **Risk Score 4.0-6.9**: Prepare emergency supplies, stay alert
- **Risk Score <4.0**: Continue normal activities with caution
- **Trend "increasing"**: Conditions are worsening, monitor closely
- **Trend "decreasing"**: Conditions are improving
- **Trend "stable"**: No significant change

## Troubleshooting

### Common Issues

1. **"No data found for this barangay"**
   - Ensure weather data exists in Supabase for the selected barangay
   - Check that the barangay name matches exactly (case-sensitive)

2. **"Failed to fetch risk report"**
   - Verify Python ML API is running on port 8000
   - Check Supabase credentials in .env file
   - Ensure network connectivity to Supabase

3. **"Failed to save risk report"**
   - Verify MongoDB connection is active
   - Check MongoDB credentials in .env file

4. **Barangays not loading**
   - Check if barangays are configured in Settings
   - Verify AppSettings collection exists in MongoDB
   - Ensure at least one active barangay exists

### Testing the ML API Directly

```bash
# Test the ML API endpoint
curl http://localhost:8000/risk-report/Mamburao

# Test with a specific barangay
curl http://localhost:8000/risk-report/Tayamaan
```

## Future Enhancements

- [ ] Real-time WebSocket updates for changing conditions
- [ ] Machine learning model training on historical data
- [ ] Predictive analytics for future risk trends
- [ ] Integration with external weather APIs
- [ ] Mobile push notifications for high-risk alerts
- [ ] Export risk reports to PDF
- [ ] Multi-language support for recommendations
- [ ] Risk map visualization on dashboard

## Support

For technical support or questions:
- Check the project documentation
- Review the API endpoint responses for error messages
- Contact the development team

---

**Last Updated**: May 6, 2026
**Version**: 2.0.0