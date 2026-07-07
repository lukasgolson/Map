package main

import "time"

type Config struct {
	ServerPort                string  `json:"server_port"`
	GarminFeedURL             string  `json:"garmin_feed_url"`
	GarminPassword            string  `json:"garmin_password"`
	GarminPollIntervalMinutes int     `json:"garmin_poll_interval_minutes"`
	OpenMeteoURL              string  `json:"open_meteo_url"`
	DataFilePath              string  `json:"data_file_path"`
	GoalLatitude              float64 `json:"goal_latitude"`
	GoalLongitude             float64 `json:"goal_longitude"`
	GoalTitle                 string  `json:"goal_title"`
}

type Coordinate struct {
	Lng       float64   `json:"lng"`
	Lat       float64   `json:"lat"`
	Timestamp time.Time `json:"timestamp"`
	Velocity  float64   `json:"velocity"`
}

type GarminPoint struct {
	Coordinate
	Battery   int       `json:"battery"`
}

type DashboardPayload struct {
	CurrentState  string       `json:"currentState"`
	History       []Coordinate `json:"history"`
	Weather       string       `json:"weather"`
	BatteryLevel  int          `json:"batteryLevel"`
	HighScore     int          `json:"highScore"`
	StatusText    string       `json:"statusText"`
	GoalLatitude  float64      `json:"goalLatitude"`
	GoalLongitude float64      `json:"goalLongitude"`
	GoalTitle     string       `json:"goalTitle"`
}

type Store struct {
	History   []Coordinate `json:"history"`
	HighScore int          `json:"highScore"`
	LastMove  time.Time    `json:"lastMove"`
	LastPoint GarminPoint  `json:"lastPoint"`
}
