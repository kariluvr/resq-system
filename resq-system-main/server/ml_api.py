from fastapi import FastAPI
from supabase import create_client
from dotenv import load_dotenv
import os

load_dotenv()

app = FastAPI()

supabase = create_client(
    os.getenv("SUPABASE_URL"),
    os.getenv("SUPABASE_KEY")
)

@app.get("/")
def home():
    return {"message": "ML Backend Running"}

def calculate_risk_score(data_points):
    """Enhanced risk calculation with weighted factors for disaster prediction"""
    if not data_points or len(data_points) == 0:
        return 0, "UNKNOWN"
    
    latest = data_points[-1]
    rainfall = latest.get("rainfall", 0)
    humidity = latest.get("humidity", 0)
    wind_speed = latest.get("wind_speed", 0)
    temperature = latest.get("temperature", 25)
    
    # Weighted risk factors (total possible: ~12 points)
    risk_score = 0.0
    
    # Rainfall (highest weight - most critical for flooding/landslides)
    if rainfall >= 15:
        risk_score += 4.0  # Severe rainfall
    elif rainfall >= 10:
        risk_score += 3.0  # Heavy rainfall
    elif rainfall >= 6:
        risk_score += 2.0  # Moderate rainfall
    elif rainfall >= 3:
        risk_score += 1.0  # Light rainfall
    
    # Humidity (contributes to storm formation)
    if humidity >= 95:
        risk_score += 2.0  # Extremely high
    elif humidity >= 90:
        risk_score += 1.5  # Very high
    elif humidity >= 85:
        risk_score += 1.0  # High
    elif humidity >= 80:
        risk_score += 0.5  # Moderate
    
    # Wind speed (critical for storm damage)
    if wind_speed >= 60:
        risk_score += 3.0  # Dangerous winds
    elif wind_speed >= 50:
        risk_score += 2.0  # Strong winds
    elif wind_speed >= 30:
        risk_score += 1.0  # Moderate winds
    
    # Temperature extremes (can exacerbate conditions)
    if temperature > 38 or temperature < 5:
        risk_score += 1.5  # Extreme temperatures
    elif temperature > 35 or temperature < 10:
        risk_score += 0.5  # Uncomfortable temperatures
    
    # Trend analysis (if historical data available)
    if len(data_points) > 1:
        prev_rainfall = data_points[-2].get("rainfall", 0)
        prev_humidity = data_points[-2].get("humidity", 0)
        prev_wind = data_points[-2].get("wind_speed", 0)
        
        # Rapid increase in rainfall is dangerous
        if rainfall > prev_rainfall * 2 and rainfall > 5:
            risk_score += 1.0  # Sudden increase
        elif rainfall > prev_rainfall * 1.5 and rainfall > 3:
            risk_score += 0.5  # Moderate increase
        
        # Increasing wind speed
        if wind_speed > prev_wind * 1.5 and wind_speed > 20:
            risk_score += 0.5
        
        # Increasing humidity
        if humidity > prev_humidity + 10 and humidity > 80:
            risk_score += 0.3
    
    # Determine risk level based on weighted score
    if risk_score >= 7.0:
        risk = "HIGH"
    elif risk_score >= 4.0:
        risk = "MODERATE"
    else:
        risk = "LOW"
    
    return risk_score, risk


def get_recommendations(risk_level):
    """Get recommendations based on risk level"""
    recommendations = {
        "HIGH": [
            "Evacuate low-lying areas immediately",
            "Prepare emergency kits and supplies",
            "Monitor weather updates continuously",
            "Contact local authorities for assistance",
            "Secure property and livestock",
            "Avoid crossing flooded areas",
            "Stay in designated evacuation centers if advised"
        ],
        "MODERATE": [
            "Monitor weather conditions closely",
            "Prepare emergency supplies",
            "Stay informed through local news",
            "Avoid unnecessary travel during bad weather",
            "Check drainage systems in your area",
            "Keep emergency contacts updated",
            "Review evacuation routes"
        ],
        "LOW": [
            "Stay aware of weather changes",
            "Keep emergency contacts updated",
            "Maintain preparedness supplies",
            "Follow local weather advisories",
            "Continue normal activities with caution"
        ],
        "UNKNOWN": [
            "No data available for risk assessment",
            "Contact local authorities for current conditions",
            "Monitor official weather updates"
        ]
    }
    return recommendations.get(risk_level, recommendations["UNKNOWN"])


@app.get("/risk-report/{barangay}")
def risk_report(barangay: str):
    try:
        response = supabase.table("weather_data") \
            .select("*") \
            .eq("city", barangay) \
            .order("timestamp", desc=True) \
            .limit(100) \
            .execute()

        data = response.data

        if not data or len(data) == 0:
            return {
                "barangay": barangay,
                "risk_level": "UNKNOWN",
                "risk_score": 0,
                "message": "No weather data found for this barangay",
                "rainfall": 0,
                "humidity": 0,
                "wind_speed": 0,
                "temperature": 0,
                "trend": "unknown",
                "data_points": 0,
                "last_updated": None,
                "recommendations": get_recommendations("UNKNOWN")
            }

        # Reverse to get chronological order for trend analysis
        data.reverse()
        latest = data[-1]

        rainfall = latest.get("rainfall", 0)
        humidity = latest.get("humidity", 0)
        wind_speed = latest.get("wind_speed", 0)
        temperature = latest.get("temperature", 25)

        # Use enhanced risk calculation
        risk_score, risk = calculate_risk_score(data)
        
        # Get recommendations
        recommendations = get_recommendations(risk)

        # Determine trend
        trend = "stable"
        if len(data) > 1:
            prev_rainfall = data[-2].get("rainfall", 0)
            if rainfall > prev_rainfall * 1.5 and rainfall > 3:
                trend = "increasing"
            elif rainfall < prev_rainfall * 0.7 and prev_rainfall > 3:
                trend = "decreasing"

        return {
            "barangay": barangay,
            "risk_level": risk,
            "risk_score": round(risk_score, 1),
            "rainfall": rainfall,
            "humidity": humidity,
            "wind_speed": wind_speed,
            "temperature": temperature,
            "trend": trend,
            "data_points": len(data),
            "last_updated": latest.get("timestamp", "unknown"),
            "recommendations": recommendations
        }
    
    except Exception as e:
        return {
            "barangay": barangay,
            "risk_level": "UNKNOWN",
            "risk_score": 0,
            "error": str(e),
            "message": "Error calculating risk report",
            "rainfall": 0,
            "humidity": 0,
            "wind_speed": 0,
            "temperature": 0,
            "trend": "error",
            "data_points": 0,
            "last_updated": None,
            "recommendations": ["System error - please try again later"]
        }
