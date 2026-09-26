import os
import sqlite3
import json
import time
from urllib import request
from datetime import datetime
from . import APP_NAME

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "metrics.db")

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    cursor = conn.cursor()
    
    # Create request_logs table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS request_logs (
            request_id TEXT PRIMARY KEY,
            timestamp TEXT,
            query TEXT,
            answer TEXT,
            retrieval_latency REAL,
            llm_latency REAL,
            total_latency REAL,
            relevance_score REAL,
            relevance_drift REAL,
            feedback INTEGER,
            status TEXT,
            error_message TEXT
        )
    """)
    
    # Create alerts table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            type TEXT,
            message TEXT,
            value REAL,
            threshold REAL
        )
    """)
    
    # Create settings table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    """)
    
    # Insert default settings if they don't exist
    default_settings = [
        ("latency_threshold", "3.0"),
        ("error_rate_threshold", "10.0"),
        ("slack_webhook", ""),
        ("email_notifications", "")
    ]
    for key, val in default_settings:
        cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (key, val))
        
    conn.commit()
    conn.close()

def get_settings():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM settings")
    rows = cursor.fetchall()
    conn.close()
    return {row["key"]: row["value"] for row in rows}

def update_settings(settings_dict):
    conn = get_connection()
    cursor = conn.cursor()
    for key, val in settings_dict.items():
        cursor.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, str(val)))
    conn.commit()
    conn.close()

def send_slack_alert(webhook_url, alert_type, message, value, threshold):
    if not webhook_url:
        return
    payload = {
        "text": f"⚠️ *{APP_NAME} Alert!* ⚠️\n*Type:* {alert_type.capitalize()}\n*Details:* {message}\n*Trigger Value:* {value}\n*Threshold:* {threshold}\n*Time:* {datetime.now().isoformat()}"
    }
    try:
        req = request.Request(
            webhook_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with request.urlopen(req) as res:
            pass
    except Exception as e:
        print(f"Failed to send Slack alert: {e}")

def create_alert(alert_type, message, value, threshold):
    conn = get_connection()
    cursor = conn.cursor()
    timestamp = datetime.now().isoformat()
    cursor.execute(
        "INSERT INTO alerts (timestamp, type, message, value, threshold) VALUES (?, ?, ?, ?, ?)",
        (timestamp, alert_type, message, value, threshold)
    )
    conn.commit()
    
    # Check if slack webhook is configured
    cursor.execute("SELECT value FROM settings WHERE key = 'slack_webhook'")
    row = cursor.fetchone()
    conn.close()
    
    slack_webhook = row["value"] if row else ""
    send_slack_alert(slack_webhook, alert_type, message, value, threshold)
    
    # Log to system console
    print(f"🚨 ALERT [{alert_type.upper()}]: {message} (Value: {value}, Threshold: {threshold})")

def check_for_alerts(request_id, total_latency, status):
    settings = get_settings()
    
    # 1. Check Latency Threshold
    try:
        latency_thresh = float(settings.get("latency_threshold", 3.0))
    except ValueError:
        latency_thresh = 3.0
        
    if total_latency > latency_thresh:
        create_alert(
            "latency",
            f"Request {request_id} exceeded latency threshold.",
            total_latency,
            latency_thresh
        )
        
    # 2. Check Error Rate Threshold in the last 10 requests
    try:
        error_thresh = float(settings.get("error_rate_threshold", 10.0))
    except ValueError:
        error_thresh = 10.0
        
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT status FROM request_logs ORDER BY timestamp DESC LIMIT 10")
    recent_statuses = [r["status"] for r in cursor.fetchall()]
    conn.close()
    
    if len(recent_statuses) >= 3:
        errors = recent_statuses.count("error")
        error_rate = (errors / len(recent_statuses)) * 100
        if error_rate > error_thresh:
            create_alert(
                "error_rate",
                f"Error rate in the last {len(recent_statuses)} requests reached {error_rate:.1f}%.",
                error_rate,
                error_thresh
            )

def calculate_relevance_drift(current_score):
    if current_score is None:
        return 0.0
        
    conn = get_connection()
    cursor = conn.cursor()
    # Fetch relevance scores of the last 15 successful requests
    cursor.execute("SELECT relevance_score FROM request_logs WHERE status = 'success' AND relevance_score IS NOT NULL ORDER BY timestamp DESC LIMIT 15")
    past_scores = [r["relevance_score"] for r in cursor.fetchall()]
    conn.close()
    
    if not past_scores:
        return 0.0
        
    avg_past = sum(past_scores) / len(past_scores)
    # Drift is the drop/change in relevance
    return current_score - avg_past

def log_request(request_id, query, answer, retrieval_latency, llm_latency, total_latency, relevance_score, status, error_message=None):
    # Calculate relevance drift before logging
    drift = calculate_relevance_drift(relevance_score) if status == "success" else 0.0
    
    conn = get_connection()
    cursor = conn.cursor()
    timestamp = datetime.now().isoformat()
    cursor.execute("""
        INSERT INTO request_logs 
        (request_id, timestamp, query, answer, retrieval_latency, llm_latency, total_latency, relevance_score, relevance_drift, status, error_message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (request_id, timestamp, query, answer, retrieval_latency, llm_latency, total_latency, relevance_score, drift, status, error_message))
    
    conn.commit()
    conn.close()
    
    # Run alert triggers asynchronously or inline (inline is simple and safe for sqlite)
    check_for_alerts(request_id, total_latency, status)

def submit_feedback(request_id, feedback_value):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE request_logs SET feedback = ? WHERE request_id = ?", (feedback_value, request_id))
    conn.commit()
    conn.close()

def get_dashboard_metrics():
    conn = get_connection()
    cursor = conn.cursor()
    
    # 1. Aggregated KPI Stats
    cursor.execute("SELECT COUNT(*) as total, SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors FROM request_logs")
    agg = cursor.fetchone()
    total_requests = agg["total"] or 0
    total_errors = agg["errors"] or 0
    success_rate = ((total_requests - total_errors) / total_requests * 100) if total_requests > 0 else 100.0
    
    cursor.execute("SELECT AVG(total_latency) as avg_tot, AVG(retrieval_latency) as avg_ret, AVG(llm_latency) as avg_llm, AVG(relevance_score) as avg_rel FROM request_logs WHERE status = 'success'")
    latencies = cursor.fetchone()
    avg_total_latency = latencies["avg_tot"] or 0.0
    avg_retrieval_latency = latencies["avg_ret"] or 0.0
    avg_llm_latency = latencies["avg_llm"] or 0.0
    avg_relevance = latencies["avg_rel"] or 0.0
    
    cursor.execute("SELECT SUM(CASE WHEN feedback = 1 THEN 1 ELSE 0 END) as positive, SUM(CASE WHEN feedback = -1 THEN 1 ELSE 0 END) as negative FROM request_logs")
    fb = cursor.fetchone()
    pos_feedback = fb["positive"] or 0
    neg_feedback = fb["negative"] or 0
    feedback_score = (pos_feedback - neg_feedback)
    
    cursor.execute("SELECT AVG(relevance_drift) as avg_drift FROM request_logs WHERE status = 'success' AND relevance_drift IS NOT NULL")
    drift_row = cursor.fetchone()
    avg_drift = drift_row["avg_drift"] or 0.0
    
    # 2. Charts Data (Last 25 requests ordered by time asc for chronological plots)
    cursor.execute("""
        SELECT timestamp, retrieval_latency, llm_latency, total_latency, relevance_score, relevance_drift, status, feedback 
        FROM request_logs 
        ORDER BY timestamp DESC LIMIT 25
    """)
    recent_for_charts = [dict(row) for row in cursor.fetchall()]
    recent_for_charts.reverse() # chronologically ascending
    
    # 3. Recent Requests list (Latest 20)
    cursor.execute("SELECT * FROM request_logs ORDER BY timestamp DESC LIMIT 20")
    recent_requests = [dict(row) for row in cursor.fetchall()]
    
    # 4. Alerts Log (Latest 15)
    cursor.execute("SELECT * FROM alerts ORDER BY timestamp DESC LIMIT 15")
    recent_alerts = [dict(row) for row in cursor.fetchall()]
    
    conn.close()
    
    return {
        "stats": {
            "total_requests": total_requests,
            "success_rate": round(success_rate, 1),
            "avg_total_latency": round(avg_total_latency, 2),
            "avg_retrieval_latency": round(avg_retrieval_latency, 2),
            "avg_llm_latency": round(avg_llm_latency, 2),
            "avg_relevance": round(avg_relevance, 2),
            "avg_drift": round(avg_drift, 3),
            "thumbs_up": pos_feedback,
            "thumbs_down": neg_feedback,
            "feedback_score": feedback_score
        },
        "charts": recent_for_charts,
        "logs": recent_requests,
        "alerts": recent_alerts,
        "settings": get_settings()
    }

