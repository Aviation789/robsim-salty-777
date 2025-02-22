/**
 * A class that manages flight plan lateral guidance.
 */
 class LNavDirector {
  /**
   * Creates an instance of the LNavDirector.
   * @param {FlightPlanManager} fpm The FlightPlanManager to use with this instance. 
   * @param {CJ4NavModeSelector} navModeSelector The nav mode selector to use with this instance.
   * @param {LNavDirectorOptions} options The LNAV options to use with this instance.
   */
  constructor(fpm, navModeSelector, options) {

    /** The FlightPlanManager instance. */
    this.fpm = fpm;

    /** The nav mode selector instance. */
    this.navModeSelector = navModeSelector;

    /** The current flight plan version. */
    this.currentFlightPlanVersion = 0;

    /**
     * The currently active flight plan.
     * @type {ManagedFlightPlan}
     */
    this.activeFlightPlan = undefined;

    /** The current director options. */
    this.options = options || new LNavDirectorOptions();

    /** The current flight plan sequencing mode. */
    this.sequencingMode = FlightPlanSequencing.AUTO;

    /** The current LNAV state. */
    this.state = LNavState.TRACKING;

    /** An instance of the LNAV holds director. */
    this.holdsDirector = new HoldsDirector(fpm, navModeSelector);

    /** An instance of the localizer director. */
    this.locDirector = new LocDirector(navModeSelector);

    /** The current nav sensitivity. */
    this.currentNavSensitivity = NavSensitivity.NORMAL;

    /** The previous crosstrack deviation. */
    this.previousDeviation = 0;
  }

  /*
		calculateRateOfTurn(maxBank) {
			const trueSpeed = Simplane.getTrueSpeed();
			const magic = 1091;
			const correction = 0.4;
			const rateOfTurn = (magic * Math.tan(maxBank)) / trueSpeed;

			return [rateOfTurn, rateOfTurn + correction];
			//return (magic * Math.tan(maxBank)) / trueSpeed;
		}
	*/

	calculateRateOfTurn(maxBank) {
		const trueSpeed = Simplane.getTrueSpeed();
		const magic = 1091;
		const correction = 0.4;
		const rateOfTurn = (magic * Math.tan(maxBank)) / trueSpeed;

		return [rateOfTurn];
	}

	getfixedMaxBank(maxBank) {
		const bank = Math.round(maxBank * Avionics.Utils.RAD2DEG);
		switch (bank) {
			case 30:
				//return 32;
				return 33;
			case 25:
				//return 26.6;
				return 28;
			case 20:
				return 23;
			//return 21.6;
			case 15:
				//return 16.1;
				return 18;
			case 10:
				//return 11;
				return 13;
		}
	}

	resolveBankKnobPosition() {
		const maxBank = SimVar.GetSimVarValue('AUTOPILOT MAX BANK', 'Radians');
		this.options.maxBankAngle = this.getfixedMaxBank(maxBank);

		this.options.degreesRollout = this.options.maxBankAngle / 2;

		const rateOfTurn = this.calculateRateOfTurn(this.options.maxBankAngle * Avionics.Utils.DEG2RAD);
		this.options.bankRate = rateOfTurn[0];

		//console.log("RATE delta: " + Math.abs(Simplane.getTurnRate() * Avionics.Utils.RAD2DEG - rateOfTurn[0]));
		//console.log('Max aircraft bank: ' + this.options.maxBankAngle);
		//console.log('Calculated bank rate (REAL): ' + rateOfTurn[0]);
		//console.log('Calculated bank rate (CORRECTION): ' + rateOfTurn[1]);
		//console.log('MSFS turn rate: ' + Simplane.getTurnRate() * Avionics.Utils.RAD2DEG);
		/**
		 * BANK LIMIT fix
		 */
		/*
		switch (SimVar.GetSimVarValue('A:AUTOPILOT MAX BANK ID', 'Number')) {
			case 0:

				this.options.maxBankAngle = 30;
				this.options.bankRate = 3;
				break;
			case 1:
				this.options.maxBankAngle = 25;
				this.options.bankRate = 2.4;
				break;
			case 2:
				this.options.maxBankAngle = 20;
				this.options.bankRate = 1.7;
				break;
			case 3:
				this.options.maxBankAngle = 15;
				this.options.bankRate = 1.25;
				break;
			case 4:
				this.options.maxBankAngle = 10;
				this.options.bankRate = 0.8;
				break;
			case 5:
				if (Simplane.getIndicatedSpeed() > 250) {
					this.options.maxBankAngle = 25;
					this.options.bankRate = 2.2;
				} else {
					this.options.maxBankAngle = 15;
					this.options.bankRate = 1.25;
				}
				break;
			default:
				this.options.maxBankAngle = 30;
				this.options.bankRate = 3;
		}
		*/
	}

  /**
   * Updates the LNavDirector.
   */
  update() {
    const currentFlightPlanVersion = SimVar.GetSimVarValue('L:WT.FlightPlan.Version', 'number');
    if (this.currentFlightPlanVersion != currentFlightPlanVersion) {
      this.handleFlightPlanChanged(currentFlightPlanVersion);
    }

    if (this.activeFlightPlan) {

      this.resolveBankKnobPosition();

			/**
			 * Only for DEBUG purpose
			 */
			if (this.sequencingMode === FlightPlanSequencing.AUTO) {
				SimVar.SetSimVarValue('L:WT_CJ4_SEQUENCING', 'number', 1);
			} else {
				SimVar.SetSimVarValue('L:WT_CJ4_SEQUENCING', 'number', 0);
			}
      const previousWaypoint = this.activeFlightPlan.getWaypoint(this.activeFlightPlan.activeWaypointIndex - 1);
      const activeWaypoint = this.activeFlightPlan.getWaypoint(this.activeFlightPlan.activeWaypointIndex);

      const planeState = LNavDirector.getAircraftState();

      const navSensitivity = this.getNavSensitivity(planeState.position);
      SimVar.SetSimVarValue('L:WT_NAV_SENSITIVITY', 'number', navSensitivity);

      this.postDisplayedNavSensitivity(navSensitivity);

      const navSensitivityScalar = this.getNavSensitivityScalar(planeState.position, navSensitivity);
      SimVar.SetSimVarValue('L:WT_NAV_SENSITIVITY_SCALAR', 'number', navSensitivityScalar);

      if (!this.delegateToHoldsDirector(activeWaypoint) && activeWaypoint && previousWaypoint) {
        this.generateGuidance(activeWaypoint, planeState, previousWaypoint, navSensitivity, navSensitivityScalar);
      }
    }
  }

  /**
   * Generates lateral guidance for LNAV.
   * @param {WayPoint} activeWaypoint The current active waypoint.
   * @param {AircraftState} planeState The current aircraft state.
   * @param {WayPoint} previousWaypoint The previous waypoint.
   * @param {number} navSensitivity The current nav sensitivity.
   * @param {number} navSensitivityScalar The current nav sensitivity scalar.
   */
  generateGuidance(activeWaypoint, planeState, previousWaypoint, navSensitivity, navSensitivityScalar) {
    const activeLatLon = new LatLon(activeWaypoint.infos.coordinates.lat, activeWaypoint.infos.coordinates.long);

    const nextWaypoint = this.activeFlightPlan.getWaypoint(this.activeFlightPlan.activeWaypointIndex + 1);
    const nextLatLon = nextWaypoint ? new LatLon(nextWaypoint.infos.coordinates.lat, nextWaypoint.infos.coordinates.long) : undefined;

    const planeLatLon = new LatLon(planeState.position.lat, planeState.position.long);

    const dtk = AutopilotMath.desiredTrack(previousWaypoint.infos.coordinates, activeWaypoint.infos.coordinates, planeState.position);
    const distanceToActive = planeLatLon.distanceTo(activeLatLon) / 1852;

    this.alertIfClose(planeState, distanceToActive);

    if (AutopilotMath.isAbeam(dtk, planeState.position, activeWaypoint.infos.coordinates)) {
      this.sequenceToNextWaypoint(planeState, activeWaypoint);
      return;
    }
    else {
      const planeToActiveBearing = planeLatLon.initialBearingTo(activeLatLon);
      const nextStartTrack = nextWaypoint ? activeLatLon.initialBearingTo(nextLatLon) : planeToActiveBearing;

      const anticipationDistance = this.getAnticipationDistance(planeState, Avionics.Utils.diffAngle(planeToActiveBearing, nextStartTrack)) * 0.9;
      if (!nextWaypoint || !nextWaypoint.isFlyover) {
        this.alertIfClose(planeState, distanceToActive, anticipationDistance);

        if (distanceToActive < anticipationDistance && !nextWaypoint.isFlyover) {
          this.sequenceToNextWaypoint(planeState, activeWaypoint);
          return;
        }
      }
    }

    if (!this.delegateToLocDirector()) {
      this.tryActivateIfArmed(previousWaypoint.infos.coordinates, activeWaypoint.infos.coordinates, planeState, navSensitivity);
      switch (this.state) {
        case LNavState.TRACKING:
          const activeMode = this.navModeSelector.currentLateralActiveState;
          const shouldExecute = distanceToActive > this.options.minimumTrackingDistance
            && (activeMode === LateralNavModeState.LNAV || (activeMode === LateralNavModeState.APPR && this.navModeSelector.approachMode === WT_ApproachType.RNAV));
          LNavDirector.trackLeg(previousWaypoint.infos.coordinates, activeWaypoint.infos.coordinates, planeState, navSensitivity, navSensitivityScalar, shouldExecute);
          break;
        case LNavState.TURN_COMPLETING:
          this.handleTurnCompleting(planeState, dtk, previousWaypoint, activeWaypoint, navSensitivity, navSensitivityScalar);
          break;
      }
    }
  }

  /**
   * Handles the turn completion phase of lateral guidance.
   * @param {AircraftState} planeState The current aircraft state.
   * @param {number} dtk The current desired track.
   * @param {WayPoint} previousWaypoint The previous (from) waypoint.
   * @param {WayPoint} activeWaypoint The active (to) waypoint.
   * @param {number} navSensitivity The current nav sensitivity.
   * @param {number} navSensitivityScalar The current nav sensitivity scalar.
   */
  handleTurnCompleting(planeState, dtk, previousWaypoint, activeWaypoint, navSensitivity, navSensitivityScalar) {
    const angleDiffToTarget = Avionics.Utils.diffAngle(planeState.trueHeading, dtk);
    if (Math.abs(angleDiffToTarget) < this.options.degreesRollout || this.navModeSelector.currentLateralActiveState !== LateralNavModeState.LNAV) {
      this.state = LNavState.TRACKING;
    }
    else {
      const turnDirection = Math.sign(angleDiffToTarget);
      const targetHeading = AutopilotMath.normalizeHeading(planeState.trueHeading + (turnDirection * 90));

      LNavDirector.trackLeg(previousWaypoint.infos.coordinates, activeWaypoint.infos.coordinates, planeState, navSensitivity, navSensitivityScalar, false);
      LNavDirector.setCourse(targetHeading, planeState);
    }
  }

  /**
   * Checks to see if the waypoint can be sequenced past.
   * @param {WayPoint} activeWaypoint The waypoint to check against.
   * @returns {boolean} True if it can be sequenced past, false otherwise.
   */
  canSequence(activeWaypoint) {
    return activeWaypoint && !(activeWaypoint.endsInDiscontinuity || activeWaypoint.isRunway);
  }

  /**
   * Alerts the waypoint will be sequenced if within the 5 second sequencing
   * threshold.
   * @param {AircraftState} planeState The current aircraft state.
   * @param {number} distanceToActive The current distance to the active waypoint.
   * @param {number} sequenceDistance The distance where LNAV will sequence to the next waypoint.
   */
  alertIfClose(planeState, distanceToActive, sequenceDistance = 0) {
    const fiveSecondDistance = (planeState.groundSpeed / 3600) * 5;
    if (distanceToActive < sequenceDistance + fiveSecondDistance && this.state !== LNavState.IN_DISCONTINUITY && this.sequencingMode !== FlightPlanSequencing.INHIBIT) {
      SimVar.SetSimVarValue('L:WT_CJ4_WPT_ALERT', 'number', 1);
    }
    else {
      SimVar.SetSimVarValue('L:WT_CJ4_WPT_ALERT', 'number', 0);
    }
  }

  /**
   * Delegates navigation to the holds director, if necessary.
   * @param {WayPoint} activeWaypoint 
   * @returns True if the holds director is now active, false otherwise.
   */
  delegateToHoldsDirector(activeWaypoint) {
    if (activeWaypoint && activeWaypoint.hasHold && !this.holdsDirector.isHoldExited(this.activeFlightPlan.activeWaypointIndex - 1)) {
      this.holdsDirector.update(this.activeFlightPlan.activeWaypointIndex);

      return this.holdsDirector.state !== HoldsDirectorState.NONE && this.holdsDirector.state !== HoldsDirectorState.EXITED;
    }

    return false;
  }

  /**
   * Delegates navigation to the localizer director, if necessary.
   * @returns True if the localizer director is now active, false otherwise.
   */
  delegateToLocDirector() {
    const armedState = this.navModeSelector.currentLateralArmedState;
    const activeState = this.navModeSelector.currentLateralActiveState;

    if ((armedState === LateralNavModeState.APPR || activeState === LateralNavModeState.APPR)
       && (this.navModeSelector.approachMode === WT_ApproachType.ILS || this.navModeSelector.lNavModeState === LNavModeState.NAV1 || this.navModeSelector.lNavModeState === LNavModeState.NAV2)) {
      this.locDirector.update();
      return this.locDirector.state === LocDirectorState.ACTIVE;
    }

    return false;
  }

  /**
   * Gets the current turn anticipation distance based on the plane state
   * and next turn angle.
   * @param {AircraftState} planeState The current aircraft state. 
   * @param {number} turnAngle The next turn angle, in degrees.
   */
  getAnticipationDistance(planeState, turnAngle) {
    const headwind = AutopilotMath.windComponents(planeState.trueHeading, planeState.windDirection, planeState.windSpeed).headwind;
    const turnRadius = AutopilotMath.turnRadius(planeState.trueAirspeed - headwind, this.options.maxBankAngle);

    const bankDiff = (Math.sign(turnAngle) * this.options.maxBankAngle) - planeState.bankAngle;
    const enterBankDistance = (Math.abs(bankDiff) / this.options.bankRate) * ((planeState.trueAirspeed - headwind) / 3600);

    const turnAnticipationAngle = Math.min(this.options.maxTurnAnticipationAngle, Math.abs(turnAngle)) * Avionics.Utils.DEG2RAD;
    return Math.min((turnRadius * Math.abs(Math.tan(turnAnticipationAngle / 2))) + enterBankDistance, this.options.maxTurnAnticipationDistance(planeState));
  }

  static turnRadiusTest(airspeedTrue, bankAngle) {
		// Normal turn radius formula
		// R =v^2/(11.23*tan(0.01745*b))
		return (Math.pow(airspeedTrue, 2) / (11.26 * Math.tan(bankAngle * Avionics.Utils.DEG2RAD)))
			/ 6076.1093456638;
	}

  /**
   * Handles when the flight plan version changes.
   * @param {number} currentFlightPlanVersion The new current flight plan version.
   */
  handleFlightPlanChanged(currentFlightPlanVersion) {
    this.activeFlightPlan = this.fpm.getFlightPlan(0);
    const activeWaypoint = this.activeFlightPlan.getWaypoint(this.activeFlightPlan.activeWaypointIndex);

    if (this.state === LNavState.TURN_COMPLETING) {
      this.state === LNavState.TRACKING;
    }

    if (this.sequencingMode === FlightPlanSequencing.INHIBIT && !activeWaypoint.isRunway) {
      this.sequencingMode = FlightPlanSequencing.AUTO;
    }

    if (this.state === LNavState.IN_DISCONTINUITY && !(activeWaypoint && activeWaypoint.endsInDiscontinuity)) {
      SimVar.SetSimVarValue("L:WT_CJ4_IN_DISCONTINUITY", "number", 0);
      this.state = LNavState.TRACKING;
    }

    SimVar.SetSimVarValue('L:WT_CJ4_WPT_ALERT', 'number', 0);
    this.currentFlightPlanVersion = currentFlightPlanVersion;
  }

  /**
   * Sequences to the next waypoint in the flight plan.
   * @param {AircraftState} planeState The current aircraft state.
   * @param {WayPoint} currentWaypoint The current active waypoint.
   */
  sequenceToNextWaypoint(planeState, currentWaypoint) {
    if (this.sequencingMode !== FlightPlanSequencing.INHIBIT && planeState.groundSpeed > 25 && !planeState.onGround) {
      const nextWaypoint = this.fpm.getWaypoint(this.activeFlightPlan.activeWaypointIndex + 1);

      if (currentWaypoint && currentWaypoint.endsInDiscontinuity) {
        this.state = LNavState.IN_DISCONTINUITY;
        SimVar.SetSimVarValue("L:WT_CJ4_IN_DISCONTINUITY", "number", 1);
        this.sequencingMode = FlightPlanSequencing.INHIBIT;
        LNavDirector.setCourse(SimVar.GetSimVarValue('PLANE HEADING DEGREES TRUE', 'Radians') * Avionics.Utils.RAD2DEG, planeState);
        SimVar.SetSimVarValue('L:WT_CJ4_WPT_ALERT', 'number', 0);
      }
      else if (nextWaypoint && nextWaypoint.isRunway) {
        this.sequencingMode = FlightPlanSequencing.INHIBIT;

        this.state = LNavState.TURN_COMPLETING;
        this.fpm.setActiveWaypointIndex(this.activeFlightPlan.activeWaypointIndex + 1, EmptyCallback.Void, 0);
      }
      else {
        this.state = LNavState.TURN_COMPLETING;
        this.fpm.setActiveWaypointIndex(this.activeFlightPlan.activeWaypointIndex + 1, EmptyCallback.Void, 0);
      }
    }
  }

  /**
   * Sets LNAV sequencing to AUTO.
   */
  setAutoSequencing() {
    const activeWaypoint = this.activeFlightPlan.getWaypoint(this.activeFlightPlan.activeWaypointIndex);
    if (this.state === LNavState.IN_DISCONTINUITY || (activeWaypoint && activeWaypoint.isRunway)) {
      this.state = LNavState.TRACKING;
      SimVar.SetSimVarValue("L:WT_CJ4_IN_DISCONTINUITY", "number", 0);

      const nextWaypointIndex = this.activeFlightPlan.activeWaypointIndex + 1;

      this.fpm.setActiveWaypointIndex(nextWaypointIndex, EmptyCallback.Void, 0);
      this.fpm.clearDiscontinuity(nextWaypointIndex - 1, 0);
    }

    this.sequencingMode = FlightPlanSequencing.AUTO;
  }

  /**
   * Sets LNAV sequencing to INHIBIT.
   */
  setInhibitSequencing() {
    this.sequencingMode = FlightPlanSequencing.INHIBIT;
  }

  /**
   * Posts the correct nav sensitivity to the displays.
   * @param {number} navSensitivity The current nav sensitivity.
   */
  postDisplayedNavSensitivity(navSensitivity) {
    if (navSensitivity !== this.currentNavSensitivity) {
      this.currentNavSensitivity = navSensitivity;

      switch (this.currentNavSensitivity) {
        case NavSensitivity.TERMINAL:
          //MessageService.getInstance().post(FMS_MESSAGE_ID.TERM, () => this.currentNavSensitivity !== NavSensitivity.TERMINAL);
          break;
        case NavSensitivity.TERMINALLPV:
          //MessageService.getInstance().post(FMS_MESSAGE_ID.TERM_LPV, () => this.currentNavSensitivity !== NavSensitivity.TERMINALLPV);
          break;
        case NavSensitivity.APPROACH:
          //MessageService.getInstance().post(FMS_MESSAGE_ID.APPR, () => this.currentNavSensitivity !== NavSensitivity.APPROACH);
          break;
        case NavSensitivity.APPROACHLPV:
          //MessageService.getInstance().post(FMS_MESSAGE_ID.APPR_LPV, () => this.currentNavSensitivity !== NavSensitivity.APPROACHLPV);
          break;
      }
    }
  }

  /**
   * Attempts to activate LNAV automatically if LNAV or APPR LNV1 is armed.
   * @param {LatLongAlt} legStart The coordinates of the start of the leg.
   * @param {LatLongAlt} legEnd The coordinates of the end of the leg.
   * @param {AircraftState} planeState The current aircraft state.
   * @param {number} navSensitivity The sensitivity to use for tracking.
   */
  tryActivateIfArmed(legStart, legEnd, planeState, navSensitivity) {
    const armedState = this.navModeSelector.currentLateralArmedState;
    const agl = Simplane.getAltitudeAboveGround();
    if ((armedState === LateralNavModeState.LNAV || (armedState === LateralNavModeState.APPR && this.navModeSelector.approachMode === WT_ApproachType.RNAV))
      && !planeState.onGround && agl > 50) {
      const xtk = AutopilotMath.crossTrack(legStart, legEnd, planeState.position);
      let activationXtk = 1.9;

      switch (navSensitivity) {
        case NavSensitivity.TERMINAL:
        case NavSensitivity.TERMINALLPV:
          activationXtk = 0.9;
          break;
        case NavSensitivity.APPROACH:
        case NavSensitivity.APPROACHLPV:
          activationXtk = 0.28;
          break;
      }

      if (Math.abs(xtk) < activationXtk) {
        this.navModeSelector.queueEvent(NavModeEvent.LNAV_ACTIVE);
      }
    }
  }

  /**
   * Tracks the specified leg.
   * @param {LatLongAlt} legStart The coordinates of the start of the leg.
   * @param {LatLongAlt} legEnd The coordinates of the end of the leg.
   * @param {AircraftState} planeState The current aircraft state.
   * @param {number} navSensitivity The sensitivity to use for tracking.
   * @param {number} navSensitivityScalar The nav sensitivity scalar.
   * @param {boolean} execute Whether or not to execute the calculated course.
   */
  static trackLeg(legStart, legEnd, planeState, navSensitivity, navSensitivityScalar = 1, execute = true) {
    const dtk = AutopilotMath.desiredTrack(legStart, legEnd, planeState.position);
    const xtk = AutopilotMath.crossTrack(legStart, legEnd, planeState.position);

    const correctedDtk = AutopilotMath.normalizeHeading(GeoMath.correctMagvar(dtk, SimVar.GetSimVarValue("MAGVAR", "degrees")));

    SimVar.SetSimVarValue("L:WT_CJ4_XTK", "number", xtk);
    SimVar.SetSimVarValue("L:WT_CJ4_DTK", "number", correctedDtk);

    const interceptAngle = AutopilotMath.interceptAngle(xtk, navSensitivity, 20);
    const bearingToWaypoint = Avionics.Utils.computeGreatCircleHeading(planeState.position, legEnd);
    const deltaAngle = Math.abs(Avionics.Utils.diffAngle(dtk, bearingToWaypoint));

    const interceptRate = Math.sign(this.previousDeviation) === 1
      ? Math.max(this.previousDeviation - xtk, 0)
      : -1 * Math.min(this.previousDeviation - xtk, 0);

    const fullDeflection = LNavDirector.getFullDeflectionValue(navSensitivity, navSensitivityScalar);
    const interceptRateScalar = Math.abs(xtk) < (fullDeflection / 2)
      ? 1 - Math.min(interceptRate / (fullDeflection / 10), 1)
      : 1;
      
    const headingToSet = deltaAngle < Math.abs(interceptAngle) ? AutopilotMath.normalizeHeading(dtk + (interceptAngle * interceptRateScalar)) : bearingToWaypoint;
    this.previousDeviation = xtk;

    if (execute) {
      LNavDirector.setCourse(headingToSet, planeState);
    }
  }

  /**
   * Sets the autopilot course to fly.
   * @param {number} degreesTrue The track in degrees true for the autopilot to fly.
   * @param {AircraftState} planeState The current state of the aircraft.
   */
  static setCourse(degreesTrue, planeState) {
    const currWindDirection = GeoMath.removeMagvar(planeState.windDirection, planeState.magVar);
    const windCorrection = AutopilotMath.windCorrectionAngle(degreesTrue, planeState.trueAirspeed, currWindDirection, planeState.windSpeed);

    let targetHeading = AutopilotMath.normalizeHeading(degreesTrue - windCorrection);
    targetHeading = GeoMath.correctMagvar(targetHeading, planeState.magVar);

    Coherent.call("HEADING_BUG_SET", 2, targetHeading);
  }

  /**
   * Gets the current state of the aircraft.
   */
  static getAircraftState() {
    const state = new AircraftState();
    state.position = new LatLongAlt(SimVar.GetSimVarValue("GPS POSITION LAT", "degree latitude"), SimVar.GetSimVarValue("GPS POSITION LON", "degree longitude"));
    state.magVar = SimVar.GetSimVarValue("MAGVAR", "degrees");

    state.groundSpeed = SimVar.GetSimVarValue("GPS GROUND SPEED", "knots");
    state.trueAirspeed = SimVar.GetSimVarValue('AIRSPEED TRUE', 'knots');
    state.onGround = SimVar.GetSimVarValue('SIM ON GROUND', 'bool') !== 0;

    state.windDirection = SimVar.GetSimVarValue("AMBIENT WIND DIRECTION", "degrees");
    state.windSpeed = SimVar.GetSimVarValue("AMBIENT WIND VELOCITY", "knots");

    state.trueHeading = SimVar.GetSimVarValue('PLANE HEADING DEGREES TRUE', 'Radians') * Avionics.Utils.RAD2DEG;
    state.magneticHeading = SimVar.GetSimVarValue('PLANE HEADING DEGREES MAGNETIC', 'Radians') * Avionics.Utils.RAD2DEG;
    state.trueTrack = SimVar.GetSimVarValue('GPS GROUND TRUE TRACK', 'Radians') * Avionics.Utils.RAD2DEG;

    state.bankAngle = SimVar.GetSimVarValue('PLANE BANK DEGREES', 'Radians') * Avionics.Utils.RAD2DEG;

    return state;
  }

  /**
   * Gets the distance from the destination airfield.
   * @param {LatLongAlt} planeCoords The current coordinates of the aircraft.
   * @returns {number} The distance from the airfield in NM.
   */
  getDestinationDistance(planeCoords) {
    const destination = this.fpm.getDestination();

    if (destination) {
      const destinationDistance = Avionics.Utils.computeGreatCircleDistance(planeCoords, destination.infos.coordinates);
      return destinationDistance;
    }

    return NaN;
  }

  /**
   * Gets the distance from the final approach fix.
   * @param {LatLongAlt} planeCoords The current coordinates of the aircraft.
   * @returns {number} The distance from the final approach fix in NM.
   */
  getFinalApproachFixDistance(planeCoords) {
    const approach = this.fpm.getApproachWaypoints(0);
    if (approach.length > 1) {
      let finalApproachFix = approach[approach.length - 2];
      const runwayFix = approach[approach.length - 1];
      let finalApproachFixDistance = runwayFix.cumulativeDistanceInFp - finalApproachFix.cumulativeDistanceInFp;
            
      if (finalApproachFixDistance < 3 && approach.length >= 3) {
        finalApproachFix = approach[approach.length - 3];
      }
      finalApproachFixDistance = 100;
      if (finalApproachFix && finalApproachFix.infos && finalApproachFix.infos.coordinates) {
        finalApproachFixDistance = Avionics.Utils.computeGreatCircleDistance(planeCoords, finalApproachFix.infos.coordinates);
      }
      return finalApproachFixDistance;
    }
    return NaN;
  }

  /**
   * Gets the current system nav sensitivity.
   * @param {LatLongAlt} planeCoords
   */
  getNavSensitivity(planeCoords) {
    const destinationDistance = this.getDestinationDistance(planeCoords);
    const fafDistance = this.getFinalApproachFixDistance(planeCoords);
    const currentWaypoint = this.fpm.getActiveWaypoint();

    const segment = this.fpm.getSegmentFromWaypoint(currentWaypoint);

    if (((fafDistance <= 3 || (currentWaypoint && currentWaypoint.isRunway))) && segment.type === SegmentType.Approach) {
      if (this.navModeSelector.currentLateralActiveState === LateralNavModeState.APPR && this.navModeSelector.approachMode === WT_ApproachType.RNAV) {
        return NavSensitivity.APPROACHLPV;
      }
      else {
        return NavSensitivity.APPROACH;
      }
    }

    if (destinationDistance <= 31) {
      if (this.navModeSelector.approachMode === WT_ApproachType.RNAV) {
        return NavSensitivity.TERMINALLPV;
      }
      else {
        return NavSensitivity.TERMINAL;
      }
    }

    return NavSensitivity.NORMAL;
  }

  /**
   * Gets the navigational sensitivity scalar for the approach modes.
   * @param {LatLong} planeCoords The current plane location coordinates.
   * @param {number} sensitivity The current navigational sensitivity mode.
   */
  getNavSensitivityScalar(planeCoords, sensitivity) {
    if (sensitivity === NavSensitivity.APPROACHLPV) {
      const runway = this.getRunway();
      if (runway) {
        const distance = Avionics.Utils.computeGreatCircleDistance(runway.infos.coordinates, planeCoords);
        return Math.min(0.1 + ((distance / 7) * 0.9), 1);
      }
    }

    return 1;
  }

  /**
   * Gets the full scale deviation value for a specified nav sensitivity.
   * @param {number} sensitivity The current nav sensitivity.
   * @param {number} scalar The nav sensitivity scalar for LPV approaches.
   */
  static getFullDeflectionValue(sensitivity, scalar) {
    switch (sensitivity) {
      case NavSensitivity.NORMAL:
        return 2;
      case NavSensitivity.TERMINALLPV:
      case NavSensitivity.TERMINAL:
        return 1;
      case NavSensitivity.APPROACH:
        return 0.3;
      case NavSensitivity.APPROACHLPV:
        return 0.3 * scalar;
    }
  }

  /**
   * Gets the approach runway from the flight plan.
   * @returns {WayPoint} The approach runway waypoint.
   */
  getRunway() {
    const approach = this.fpm.getApproachWaypoints();
    if (approach.length > 0) {
      const lastApproachWaypoint = approach[approach.length - 1];

      if (lastApproachWaypoint.isRunway) {
        return lastApproachWaypoint;
      }
    }
  }
}

/**
 * Options for lateral navigation.
 */
class LNavDirectorOptions {

  /**
   * Creates an instance of LNavDirectorOptions.
   */
  constructor() {
    /** 
     * The minimum distance in NM that LNAV will track towards the active waypoint. This
     * value is used to avoid swinging towards the active waypoint when the waypoint is close,
     * if the plane is off track.
     */
    this.minimumTrackingDistance = 1;

		/** The maximum bank angle of the aircraft. */
		this.maxBankAngle = 30;

		/** The rate of bank in degrees per second. */
		this.bankRate = 3;

    /** The maximum turn angle in degrees to calculate turn anticipation to. */
    this.maxTurnAnticipationAngle = 110;

    /** A function that returns the maximum turn anticipation distance. */
    this.maxTurnAnticipationDistance = (planeState) => planeState.trueAirspeed < 350 ? 7 : 10;

    /** The number of degrees left in the turn that turn completion will stop and rollout/tracking will begin. */
    this.degreesRollout = 20;
  }
}

/**
 * The current state of the aircraft for LNAV.
 */
class AircraftState {
  constructor() {
    /** 
     * The true airspeed of the plane. 
     * @type {number}
     */
    this.trueAirspeed = undefined;

    /**
     * The ground speed of the plane.
     * @type {number}
     */
    this.groundSpeed = undefined;

    /**
     * The current plane location magvar.
     * @type {number}
     */
    this.magVar = undefined;

    /**
     * The current plane position.
     * @type {LatLonAlt}
     */
    this.position = undefined;

    /**
     * The wind speed.
     * @type {number}
     */
    this.windSpeed = undefined;

    /**
     * The wind direction.
     * @type {number}
     */
    this.windDirection = undefined;

    /**
     * The current heading in degrees true of the plane.
     * @type {number}
     */
    this.trueHeading = undefined;

    /**
     * The current heading in degrees magnetic of the plane.
     * @type {number}
     */
    this.magneticHeading = undefined;

    /**
     * The current track in degrees true of the plane.
     * @type {number}
     */
    this.trueTrack = undefined;

    /**
     * The current plane bank angle.
     * @type {number}
     */
    this.bankAngle = undefined;

    /**
     * Whether or not the plane is on the ground.
     * @type {boolean}
     */
    this.onGround = undefined;
  }
}

class FlightPlanSequencing { }
FlightPlanSequencing.AUTO = 'AUTO';
FlightPlanSequencing.INHIBIT = 'INHIBIT';

class LNavState { }
LNavState.TRACKING = 'TRACKING';
LNavState.TURN_COMPLETING = 'TURN_COMPLETING';
LNavState.IN_DISCONTINUITY = 'IN_DISCONTINUITY';

/** The sensitivity of the navigation solution. */
class NavSensitivity { }
/** Vertical and lateral sensitivity is at normal +/- 2.0NM enroute levels. */
NavSensitivity.NORMAL = 0;
/** Vertical and lateral sensitivity is at +/- 1.0NM terminal levels. */
NavSensitivity.TERMINAL = 1;
/** Vertical and lateral sensitivity is at +/- 1.0NM terminal levels. */
NavSensitivity.TERMINALLPV = 2;
/** Vertical and lateral sensitivity is at +/- 0.3NM approach levels. */
NavSensitivity.APPROACH = 3;
/** Vertical and lateral sensitivity increases as distance remaining on final decreases. */
NavSensitivity.APPROACHLPV = 4;
