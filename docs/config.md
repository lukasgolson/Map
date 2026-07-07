# Configuration Documentation

This document describes each configuration option defined in `config.json` for Project Dino-Transit.

## Configuration Options

### `server_port`
* **Type:** String
* **Description:** The port number on which the Go HTTP server runs and listens for incoming requests.
* **Example:** `"8080"`

### `garmin_feed_url`
* **Type:** String
* **Description:** The URL of your public Garmin InReach Share KML feed. The backend polls this URL to fetch live location updates.
* **Example:** `"https://share.garmin.com/Feed/Share/lukasgolson"`

### `garmin_password`
* **Type:** String
* **Description:** The password configured for password-protected Garmin Share feeds. Used by the server for Basic Authentication when querying the Garmin feed.
* **Example:** `"6048179714"`

### `garmin_poll_interval_minutes`
* **Type:** Integer
* **Description:** The standard interval (in minutes) at which the backend queries the live Garmin feed. Used only when `poll_interval_seconds` is set to `0` or omitted.
* **Example:** `10`

### `use_test_server`
* **Type:** Boolean
* **Description:** Toggles between live data and test simulation mode.
  - `false`: Polls the live Garmin InReach feed.
  - `true`: Redirects the poller to retrieve mock data from the local server's `/api/v1/test-kml` endpoint. Also triggers database backup and seeds a simulated Vancouver route.
* **Example:** `true`

### `poll_interval_seconds`
* **Type:** Integer
* **Description:** Configures a high-frequency polling interval (in seconds) primarily used for rapid route tracking in test mode. If greater than `0`, this value overrides `garmin_poll_interval_minutes`.
* **Example:** `600`

### `open_meteo_url`
* **Type:** String
* **Description:** The API URL for Open-Meteo weather forecasts. The backend uses this endpoint to fetch weather conditions at the latest coordinates.
* **Example:** `"https://api.open-meteo.com/v1/forecast"`

### `data_file_path`
* **Type:** String
* **Description:** The path to the JSON flat-file database where active expedition coordinates, high score, and latest movement states are stored.
* **Example:** `"data.json"`

### `goal_latitude`
* **Type:** Float
* **Description:** The latitude of the target destination/endpoint of the expedition.
* **Example:** `56.0653`

### `goal_longitude`
* **Type:** Float
* **Description:** The longitude of the target destination/endpoint of the expedition.
* **Example:** `-98.2004`

### `goal_title`
* **Type:** String
* **Description:** The name or label of the expedition's destination, displayed in the dashboard header.
* **Example:** `"Martin & Olson; Kapakaytay Falls, MB, Canada"`
