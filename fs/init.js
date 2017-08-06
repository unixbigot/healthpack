//
// Healthpack - a smart medicine cabinet for ESP32 and AWS IoT
//
// This file connects to AWS IoT and implements a medication reminder.
// It reads a door sensor, and maintains a coloured lighting display.
//
//
// See README.md for more information.
// 


//
// Load Mongoose OS API shims
//
print("*** MJS INCLUDES ***");

load('api_config.js');
load('api_gpio.js');
load('api_timer.js');
load('api_rpc.js');
load('api_aws.js');
load('api_net.js');
load('api_mqtt.js');
load('api_neopixel.js');
load('api_sys.js');

//
// Initialise our application resources
//
print("*** MJS INIT ***");     

let pin_led = 5;   // ESP32's on-board LED

//
// Globals
//
let pin_sens = 36;  // Pin number for the door switch (hall-effect sensor)
let pin_neo = 17;   // Pin number for the WS2812 "NeoPixel" string
let numPixels = 7;  // Length of the neopixel string
let colorOrder = NeoPixel.GRB; 
let strip = NeoPixel.create(pin_neo, numPixels, colorOrder);
let n = 0, topn=12; // Position in the animated LED loop

let colors = {      // colour lookup table for neopixel display
  "blue": [0,0,50],
  "red": [255,0,0],
  "green": [0,50,0],
  "amber": [255,126,0],
};

let floor = ffi('double floor(double)');
let ram = floor(Sys.free_ram()/1024);

// AWS IoT Device Shadow document
//
// This is the persistent state of the "Thing" maintained by AWS.
//
// The thing will receive a shadow document update at startup,
// which restores the last known state of the device.
//
// We start out blue until we know the current time.
//

let state = { 
  color: "blue", 		// What colour is the LED display
  open: false,			// Is the door open or closed?
  last_dose: 0,			// The time of the last known dose
  dose_interval: 24,		// The interval in hours between doses
  dose_warn: 1,			// Number of hours warning to fgive of next dose
  last_boot: 0,			// Time of the last reboot
  uptime: 0,			// Uptime since last reboot
  remound: false,		// Has an upcoming-dose reminder been sent?
  alerted: false,  		// Has an overdue-dose alert been seen?
  notify: "you@example.com"	// Email or phone number for notifications
};

let topic_base = 'healthpack/' + Cfg.get('device.id');

RPC.addHandler('healthpack.SetState', function(args) {
  for (let key in args) {
    state[key] = args[key];
  }
  return state;
});

RPC.addHandler('healthpack.GetState', function(args) {
  return state;
});

RPC.addHandler('healthpack.GetLastDose', function(args) {
  return state.last_dose;
});

RPC.addHandler('healthpack.GetDoseInterval', function(args) {
  return state.dose_interval;
});

RPC.addHandler('healthpack.GetDoseWarn', function(args) {
  return state.dose_warn;
});


//
// Get the current time as javascript microseconds
//
function now() {
  return ffi('double mg_time()')();
}

//
// Input poll callback - This is invoked to check the door switch and
// to drive the LED animation
//
function cb_tick() {
  //
  // Check the door sensor
  //
  let open = GPIO.read(pin_sens);


  //
  // Advance the LED animation
  //
  // The LED display is a 7-element string with a circle of 6 LEDs and one central LED.
  // The animation consists of 12 'frames'.
  // Denoting the central LED as zero, the frame sequence is 1 0 2 0 3 0 4 0 5 0 6 0
  //
  strip.clear();
  n = ( n + 1 ) % topn;  // n is the frame number.  Advance to the next frame.
  let p = n;
  if (n & 1) {
    p = 0;		// Light the central LED on every odd frame
  } else {
    p = 1 + (n >> 1);   // On even frames, light the outer LEDs 1 through 6
  }

  // If we detected a change of door state, we send a door change event

  if (open && !state.open) {
    // We detected the door opening since last poll.  Send an open (dose) event
    send_dose();
  }

  if (state.open && !open) {
    // We detected the door closing since last poll.   Send a close event.
    send_close();
  }

  if (!open) {
    //
    // The door is closed.
    //
    // Calculate how long the door has been closed, and decide whether 
    // a dose is due, or overdue.
    //
    let time_since_last_dose = now() - state.last_dose;
    let hours_since_last_dose = time_since_last_dose / 3600;

    if (hours_since_last_dose > state.dose_interval) {
      //
      // The next does is overdue.  Make the LED display RED, and
      // send an alert (if not already sent)
      state.color = "red";

      if (!state.alerted) {
        send_alert(hours_since_last_dose);
      }
      
    } else if (hours_since_last_dose > (state.dose_interval-state.dose_warn) ) {
      //
      // The next dose is due soon.   Make the LED display AMBER, and
      // send a reminder (if not already sent)
      //
      state.color = "amber";

      if (!state.remound) {
        //
        // BTW 'remound' is a family joke.  As a small child I declared that
        // since the past-tense of the verb 'to find' is 'found', therefore
        // the past-tense of 'to remind' is clearly 'remound'.
        // 'Reminded' sounds silly by comparison :)
        //
        send_reminder(state.dose_interval-hours_since_last_dose);
      }

    } else if ((state.last_dose > 0) && (state.color === "blue")) {
      //
      // We received a shadow update, we now know the time.
      //
      // The thing starts out blue.  Shortly after booting, the device
      // will receive an AWS IoT shadow update, holding the time of the last
      // dose.  At this point we know when the next dose is due.
      //
      // Advance to the green state (which may be wrong), if the dose is due
      // the next poll will advance to the correct state.
      //
      state.color = "green";
      state_update();
    }
  }
  
  let rgb = colors[state.color||"blue"];	// Choose the colour of the display
  
  strip.setPixel(p, rgb[0], rgb[1], rgb[2]);	// Light the display according to frame
  strip.show();					// Update the display

}

//
// Send an update of device state up to AWS IoT
//
// (This is sent as a reserved topic on the MQTT bus)
//
function state_update() {
  state.uptime = Sys.uptime();
  print("state update:", JSON.stringify(state));
  AWS.Shadow.update(0, {desired: state}); 
}

//
// Send a Dose (door open) event over MQTT as topic DEVICEID/event/dose
// Include the uptime as a payload (not really needed)
// Also send a shadow update with new state.
//
function send_dose() {
  let when = now();
  print("*** DOSE EVENT", when);

  //
  // Construct and transmit an MQTT message consisting of topic and payload
  //
  let topic = topic_base + '/event/dose'; 
  let uptime = Sys.uptime();
  let payload = JSON.stringify({
    uptime: uptime,
  });
  print("    PUB to",topic);
  let ok = MQTT.pub(topic, payload, 1);
  if (!ok) {
    print("    WARN: MQTT publish failed")
  }

  //
  // Update the shadow document and transmit a shadow update
  //
  // Record that a dose was taken now, and move to the "green" state.
  //
  state.open = true;
  state.last_dose = when;
  state.color = "green";
  state.remound = false;
  state.alerted = false;
  state.uptime = uptime;
  state_update();
}

//
// Send a close door event over MQTT as topic DEVICEID/event/close
//
function send_close() {
  let when = now();
  print("*** CLOSE EVENT", when);

  //
  // Construct and transmit an MQTT message (use uptime as the payload)
  //
  let topic = topic_base + '/event/close';
  let payload = JSON.stringify({
    uptime: Sys.uptime(),
  });
  print("    PUB to",topic);
  let ok = MQTT.pub(topic, payload, 1);
  if (!ok) {
    print("    WARN: MQTT publish failed")
  }

  //
  // Update the shadow document with changed state
  //
  state.open = false;
  state_update();
}


//
// Send an application start event over MQTT as topic DEVICEID/event/startup
//
function send_startup() {
  let when = now();
  print("*** STARTUP EVENT", when);
  
  //
  // Construct and transmit an MQTT message (use uptime as the payload)
  //
  let topic = topic_base + '/event/startup';
  let payload = JSON.stringify({
    uptime: Sys.uptime(),
  });
  let ok = MQTT.pub(topic, payload, 1);
  if (!ok) {
    print("    WARN: MQTT publish failed")
  }

  //
  // Update the shadow document
  //
  state.last_boot = now() - Sys.uptime();
  state_update();
}

//
// Send a 'dose due soon' reminder event over MQTT as topic DEVICEID/event/reminder
//
function send_reminder(time_to_next_dose) {
  print("*** SEND REMINDER", time_to_next_dose);

  //
  // Construct and transmit an MQTT message (use time to next dose as the payload)
  //
  let topic = topic_base + '/event/reminder';
  let uptime = Sys.uptime();
  let payload = JSON.stringify({
    uptime: uptime,
    time_to_next_dose: time_to_next_dose
  });
  let ok = MQTT.pub(topic, payload, 1);
  if (!ok) {
    print("    WARN: MQTT publish failed")
  }

  //
  // If the transmit succeeded, record that we have sent
  // a reminder (so that we do not spam).
  //
  // If the transmit failed, we will retry on the next tick
  //
  if (ok) {
    state.remound = true;
    state.uptime = uptime;
    state_update();
  } else {
    print("Failed to send reminder");
  }
}

//
// Send a 'dose overdue' alert event over MQTT as topic DEVICEID/event/reminder
//
function send_alert(time_since_last_dose) {
  print("*** SEND ALERT", time_since_last_dose);

  //
  // Construct and transmit an MQTT message (use time since last dose as the payload)
  //
  let topic = topic_base + '/event/alert';
  let uptime = Sys.uptime();
  let payload = JSON.stringify({
    uptime: uptime,
    time_since_last_dose: time_since_last_dose
  });
  let ok = MQTT.pub(topic, payload, 1);
  if (!ok) {
    print("    WARN: MQTT publish failed")
  }

  //
  // If the transmit succeeded, record that we have sent
  // an alert (so that we do not spam).
  //
  // If the transmit failed, we will retry on the next tick
  //
  if (ok) {
    state.alerted = true;
    state.uptime = uptime;
    state_update();
  } else {
    print("Failed to send alert");
  }
}

//
// Callback for AWS IoT shadow document events
//
function aws_state_handler(data, event, reported, desired) {

  //
  // Upon startup, report current actual state, (in AWS terminology "reported")
  //
  // When cloud sends us a command to update state (AWS term "desired"), do it
  //
  //print("*** EVENT ", JSON.stringify(event));
  //print("    data ", JSON.stringify(data));

  if (event === AWS.Shadow.CONNECTED) {
    //
    // Upon initial connection to AWS IoT, we transmit our current state
    //
    print("*** AWS Shadow connected");
    AWS.Shadow.update(0, {reported: state});  // Report device state
    send_startup();
  } else if (event === AWS.Shadow.UPDATE_DELTA) {
    //
    // Upon receiving a shadow update from AWS we apply the update
    // and then reply with the complete current state.
    //
    print("*** AWS Shadow update");

    // Apply each received state change
    for (let key in state) {
      if (desired[key] !== undefined) {
        state[key] = desired[key];
        print(" ** Update state ",key,"<=",desired[key]);
      }
    }

    // Transmit the complete current state
    print("Reporting state");
    AWS.Shadow.update(0, {reported: state});  // Report device state
  }

  // Dump the state to console for debugging.  Comment this out if too noisy.
  print(JSON.stringify(reported), JSON.stringify(desired));

}

//
// Begin the application.
//
// This is triggered by a one-shot timer to allow the option to abort startup
// during debugging.
// 
function app_start() {
  print("*** APP START ***");

  // Light a LED to show we have begun to execute
  strip.clear();
  strip.setPixel(0, 0, 0, 10);
  strip.show();

  // Blink built-in LED every 1 second
  GPIO.set_mode(pin_sens, GPIO.MODE_INPUT);
  GPIO.set_mode(pin_led, GPIO.MODE_OUTPUT);
  Timer.set(1000, true, cb_tick, null);

  // Initiate the AWS IoT shadow document handler
  AWS.Shadow.setStateHandler(aws_state_handler, null);

  // Print a ready banner to announce application is running
  print("*** MJS",ram,"kB","READY ***");
  for (let i=0;i<4;i++) { print("") }
}

//
// Application start
//
// Instead of starting immediately at power-on, we wait for 5 seconds.
//
// This is because, should you make a change that induces a crash loop,
// this tactic gives you a window of opportunity to rescue the device
// (by uploading a new file) without having to completely re-flash it.
//
print("App start in 5 seconds");
Timer.set(5000, false, function() { app_start() }, null);

