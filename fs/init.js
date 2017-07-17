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

print("*** MJS INIT ***");


//
// Load Mongoose OS API
//

let pin_led = 5;

//
// Globals
//
let pin_sens = 36;
let pin_neo = 17, numPixels = 7, colorOrder = NeoPixel.GRB;
let strip = NeoPixel.create(pin_neo, numPixels, colorOrder);
let n = 0;
let topn=12;
let floor = ffi('double floor(double)');
let ram = floor(Sys.free_ram()/1024);
let colors = {
  "blue": [0,0,50],
  "red": [255,0,0],
  "green": [0,50,0],
  "amber": [255,126,0],
};

// Device Shadow

let state = { 
  color: "blue",
  open: false,
  last_dose: 0,
  dose_interval: 24,
  dose_warn: 1,
  last_boot: 0,
  uptime: 0,
  remound: false,
  alerted: false,
  phone: "0407722799"
};


function now() {
  return ffi('double mg_time()')();
}


// Input poll

function cb_tick() {
  let open = GPIO.read(pin_sens);

  strip.clear();
  n=(n+1)%topn;
  let p = n;
  if (n & 1) {
    p = 0;
  } else {
    p = 1 + (n >> 1);
  }
  //print("n = ", n, "  p = ", p);
  
  if (open && !state.open) {
    // open (dose) event
    send_dose();
  }
  if (state.open && !open) {
    // close event
    send_close();
  }
  if (!open) {
    let time_since_last_dose = now() - state.last_dose;
    let hours_since_last_dose = time_since_last_dose / 3600;
    if (hours_since_last_dose > state.dose_interval) {
      state.color = "red";
      if (!state.alerted) {
        send_alert(hours_since_last_dose);
      }
    } else if (hours_since_last_dose > (state.dose_interval-state.dose_warn) ) {
      state.color = "amber";
      if (!state.remound) {
        send_reminder(state.dose_interval-hours_since_last_dose);
      }
    } else if ((state.last_dose > 0) && (state.color === "blue")) {
      // we received a shadow update, we now know the time
      state.color = "green";
      state_update();
    }
  }
  
  let rgb = colors[state.color||"blue"];
  
  strip.setPixel(p, rgb[0], rgb[1], rgb[2]);
  strip.show();

}

function state_update() {
  state.uptime = Sys.uptime();
  print("state update:", JSON.stringify(state));
  AWS.Shadow.update(0, {desired: state}); 
}

function send_dose() {
  let when = now();
  print("*** DOSE EVENT", when);

  let topic = Cfg.get('device.id') + '/event/dose';
  let uptime = Sys.uptime();
  let message = JSON.stringify({
    uptime: uptime,
  });
  let ok = MQTT.pub(topic, message, 1);

  state.open = true;
  state.last_dose = when;
  state.color = "green";
  state.remound = false;
  state.alerted = false;
  state.uptime = uptime;
  state_update();
}

function send_close() {
  let when = now();
  print("*** CLOSE EVENT", when);
  
  let topic = Cfg.get('device.id') + '/event/close';
  let message = JSON.stringify({
    uptime: Sys.uptime(),
  });
  let ok = MQTT.pub(topic, message, 1);
  
  state.open = false;
  state_update();
}

function send_startup() {
  let when = now();
  print("*** STARTUP EVENT", when);
  
  let topic = Cfg.get('device.id') + '/event/startup';
  let message = JSON.stringify({
    uptime: Sys.uptime(),
  });
  let ok = MQTT.pub(topic, message, 1);

  state.last_boot = now() - Sys.uptime();
  state_update();
}

function send_reminder(time_to_next_dose) {
  print("*** SEND REMINDER", time_to_next_dose);
  let topic = Cfg.get('device.id') + '/event/reminder';
  let uptime = Sys.uptime();
  let message = JSON.stringify({
    uptime: uptime,
    time_to_next_dose: time_to_next_dose
  });
  let ok = MQTT.pub(topic, message, 1);
  if (ok) {
    state.remound = true;
    state.uptime = uptime;
    state_update();
  } else {
    print("Failed to send reminder");
  }
}

function send_alert(time_since_last_dose) {
  print("*** SEND ALERT", time_since_last_dose);
  let topic = Cfg.get('device.id') + '/event/alert';
  let uptime = Sys.uptime();
  let message = JSON.stringify({
    uptime: uptime,
    time_since_last_dose: time_since_last_dose
  });
  let ok = MQTT.pub(topic, message, 1);
  if (ok) {
    state.alerted = true;
    state.uptime = uptime;
    state_update();
  } else {
    print("Failed to send alert");
  }
}



function aws_state_handler(data, event, reported, desired) {
  // Upon startup, report current actual state, "reported"
  // When cloud sends us a command to update state ("desired"), do it
  //print("*** EVENT ", JSON.stringify(event));
  //print("    data ", JSON.stringify(data));
  if (event === AWS.Shadow.CONNECTED) {
    print("*** AWS Shadow connected");
    AWS.Shadow.update(0, {reported: state});  // Report device state
    send_startup();
  } else if (event === AWS.Shadow.UPDATE_DELTA) {
    print("*** AWS Shadow update");
    for (let key in state) {
      if (desired[key] !== undefined) {
        state[key] = desired[key];
        print(" ** Update state ",key,"<=",desired[key]);
      }
    }
    print("Reporting state");
    AWS.Shadow.update(0, {reported: state});  // Report device state
  }
  print(JSON.stringify(reported), JSON.stringify(desired));
}

function app_start() {
  print("*** APP START ***");
  strip.clear();
  strip.setPixel(0, 0, 0, 10);
  strip.show();

  // Blink built-in LED every second
  GPIO.set_mode(pin_sens, GPIO.MODE_INPUT);
  GPIO.set_mode(pin_led, GPIO.MODE_OUTPUT);
  Timer.set(1000, true, cb_tick, null);


  AWS.Shadow.setStateHandler(aws_state_handler, null);
  
  print("*** MJS",ram,"kB","READY ***");
  for (let i=0;i<4;i++) { print("") }
}

print("App start in 5 seconds");
Timer.set(5000, false, function() { app_start() }, null);

