/*** utils ***/
/** GUID GENERATOR * */
var generateUUID = (function() {
	function s4() {
		return Math.floor((1 + Math.random()) * 0x10000).toString(16)
				.substring(1);
	}
	return function() {
		return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4()
				+ s4() + s4();
	};
})();
/*** /END utils ***/

StickersInfo = function(clientUUID, timeParam, nickname, place, selfInfo, neededStickers, availableStickers, firstMessage) {
	var _self = this;
	_self.clientUUID = clientUUID,
	_self.time = timeParam,
	_self.nickname = nickname!=null?nickname:"",
	_self.place = place!=null?place:"",
	_self.selfInfo = selfInfo!=null?selfInfo:"",
	_self.neededStickers = neededStickers != null ? neededStickers : new Array() ,
	_self.availableStickers = availableStickers != null ? availableStickers : new Array()
	_self.stickersForReceivingFromPeer = new Array();
	_self.stickersForGivingToPeer = new Array();
	_self.firstMessage = firstMessage;
};


//***** VIEW VIEWMODELS ******//
/** SELECTABLE ITEMS MODEL - Needed and Available Stickers * */
function SelectableItemsViewModel(viewId, viewPageTitle, storageName0, defaultItems) {
	var _self = this;

	_self.id = viewId;
	_self.pageTitle = viewPageTitle;

	var _observable = ko.observable(0);
	_self.items = new ko.observableArray();
	_self._observable = ko.observable(0);
	_self._dirty = false;
	_self.storageName = storageName0;

	// recover previous selected state from storage
	var _plainItems = defaultItems;
	if(_self.storageName!=null) {
		var _storedJson = localStorage[_self.storageName + "-items"];
		if (_storedJson != null) {
			var resItems = JSON.parse(_storedJson);
			if (resItems != null && resItems.length > 0) {
				_plainItems = resItems;
			}
		}
	}

	// transform plain items array to observable
	for ( var i = 0; i < _plainItems.length; i++) {
		var oi = SelectableItemsViewModel._createObservableItem(
				_plainItems[i].number, _plainItems[i].selected, this);
		_self.items.push(oi);
	}

	// store changes locally and notify peers from time to time when something
	// has changed
	window.setInterval(function() {
		if (_self._dirty) {
			// store changes locally
			var recItems = new Array();
			for ( var i = 0; i < _self.items().length; i++) {
				recItems.push({
					number : _self.items()[i].number,
					selected : _self.items()[i].selected()
				});
			}
			if(_self.storageName!=null) {
				localStorage[_self.storageName + "-items"] = JSON.stringify(recItems);
			}

			// notify listeners about changes
			_self._observable(new Date().getTime());

			_self._dirty = false;
		}
	}, 3000);

}

SelectableItemsViewModel.prototype.subscribeToChanges = function(callbackFunction) {
	this._observable.subscribe(callbackFunction);
};

SelectableItemsViewModel.prototype.toggleSelection = function(item) {
	item.selected(!item.selected());
};

SelectableItemsViewModel._createObservableItem = function(itemNumber, itemSelected,
		viewModel) {
	var observableSelected = ko.observable(itemSelected);

	// store changes as they are done
	observableSelected.subscribe(function(newValue) {
		viewModel._dirty = true;
	});

	return {
		number : itemNumber,
		selected : observableSelected
	};
};

/** CONNECT VIEW MODEL * */
function ConnectViewModel(viewId, viewPageTitle) {
	var _self = this;
	_self.id = viewId;
	_self.pageTitle = viewPageTitle;
}

/** NEAR PEOPLE TO EXCHANGE VIEW MODEL * */
function NearPeopleViewModel(viewId, viewPageTitle) {
	var _self = this;
	_self.id = viewId;
	_self.pageTitle = viewPageTitle;
	_self.connectedPeople = ko.observableArray();
	_self.selectedPeer = ko.observable();
	_self.selectPeer = function(peer) {
		_self.selectedPeer(peer);
	}

}

/** EXCHANGING STICKERS VIEW MODEL * */
function ExchangingArenaViewModel(viewId, viewPageTitle) {
	var _self = this;
	_self.id = viewId;
	_self.pageTitle = viewPageTitle;
	_self.currentPeer = ko.observable(new StickersInfo());
	_self.combinedStickers = ko.computed(function() {
		var combinedArray = _self.currentPeer().stickersForGivingToPeer.concat(_self.currentPeer().stickersForReceivingFromPeer);
		return combinedArray.sort(function(a,b){
			return a.number > b.number;
		});
	});
	_self.isProcurada = function(item) {
		return _self.currentPeer().stickersForReceivingFromPeer.filter(function(el){
			return el == item;
		}).length > 0 ? 'figurinha-procurada' : 'figurinha-repetida';
	}
	_self.toggleSelection = function(item) {
		item.selected(!item.selected());
	}
}

/** end of -- INTERNAL VIEW MODELS -- **/

/** -- GLOBAL VIEW MODEL -- **/
function AppViewModel() {

	var _self = this;

	//____model stuff
	var _defaultItems1 = new Array();
	for ( var i = 1; i <= 639; i++) {
		_defaultItems1.push({
			number : i,
			selected : false
		});
	}

	var _defaultItems2 = new Array();
	for ( var i = 1; i <= 639; i++) {
		_defaultItems2.push({
			number : i,
			selected : false
		});
	}

	// create and store an uid for this application for later reuse
	_self.clientUUID = localStorage["clientUUID"];
	if (_self.clientUUID == null) {
		_self.clientUUID = generateUUID();
		localStorage["clientUUID"] = _self.clientUUID;
	}

	//MQTT connection manager setup
	_self.mqttConnectionManager = new MQTTConnectionManager(
										"gostutz.com/mqtt", false, "user", "user", 
										10, 25, 0, 2000);
	_self.mqttConnectionManager.onConnectingToTargetServer = function() {
		_self.mqttConnecting(true);
	}
	_self.mqttConnectionManager.onConnectedToTargetServer = function() {
		_self.mqttConnecting(false);
		_self.mqttConnected(true);
		localStorage["connectedToServer"] = true;
		_self.publishStickersInfoToServer(true);
	}
	_self.mqttConnectionManager.onDisconnectedFromServer = function() {
		_self.mqttConnected(false);
		localStorage["connectedToServer"] = false;
		_self.mqttConnecting(false);
	}

	_self.mqttConnectionManager.subscribeToTopic("/main/notclassified");
	_self.mqttConnectionManager.subscribeToTopic("/clients/" + _self.clientUUID);

	_self.mqttConnectionManager.onMessageArrived = function(message) {
		try {
			console.log("Message arrived: " + message.payloadString);
			stickersInfo = JSON.parse(message.payloadString);

			if (stickersInfo.clientUUID === _self.clientUUID) {
				return;
			}
			stickersInfo.timeElapsedInfo = ko.observable("Há poucos segundos");
			
			//remove previous results from peer
			var index = -1;
			for(var i=0; i<_self.receivedStickersInfo.length; i++) {
				if(stickersInfo.clientUUID==_self.receivedStickersInfo[i].clientUUID) {
					index = i;
					break;
				}
			}

			//remove previous results from this peer			
			if(index > -1) {
				_self.receivedStickersInfo.splice(index,1);
			}

			//if this is the first message from sender, send self stickers to him
			if(stickersInfo.firstMessage) {
				_self.publishStickersInfoToServer(false);
			}
			
			_self.receivedStickersInfo.push(stickersInfo);
			_self.recalculateStickersInfoRanking();
		} catch(e) {
			console.log(e);
		}
	};

	_self.mqttConnecting =  ko.observable(false);
	_self.mqttConnected =  ko.observable(false);

	_self.receivedStickersInfo = new Array();
	// /END OF ____model stuff


	//views ~ <section>
	//Do smart assynchronous publishing
	_self.lastDirtyTime = new Date().getTime();
	_self.stickersUpdateTimerActivated = false;
	_self.handleStickersUpdate = function() {
		var timeSinceLastDirtyUpdate = new Date().getTime()-_self.lastDirtyTime;
		if(timeSinceLastDirtyUpdate > 4000) {
			_self.publishStickersInfoToServer(false)
			_self.recalculateStickersInfoRanking();
		} else {
			//if nothing else happens, do the real publishing
			if(!_self.stickersUpdateTimerActivated) {
				window.setTimeout(
					function() {
						_self.publishStickersInfoToServer(false)
						_self.recalculateStickersInfoRanking();
						_self.stickersUpdateTimerActivated = false;
					}, 4000);
				_self.stickersUpdateTimerActivated = true;
			}
		}
		_self.lastDirtyTime = new Date().getTime();
	}

	//#1 - needed stickers
	_self.viewNeededStickers = new SelectableItemsViewModel(1, "Figurinhas Faltando", "needed-stickers", _defaultItems1);
	_self.viewNeededStickers.subscribeToChanges(_self.handleStickersUpdate);

	//#2 - available stickers
	_self.viewAvailableStickers = new SelectableItemsViewModel(2, "Figurinhas Repetidas", "available-stickers", _defaultItems2);
	_self.viewAvailableStickers.subscribeToChanges(_self.handleStickersUpdate);

	//#3 - connect form
	_self.viewConnect = new ConnectViewModel(4, "Conectando-se");
	_self.viewConnect.nickname = localStorage["nickname"] === undefined ? ko.observable() : ko.observable(localStorage["nickname"]);
	_self.viewConnect.place = localStorage["place"] === undefined ? ko.observable() : ko.observable(localStorage["place"]);
	_self.viewConnect.selfInfo = localStorage["selfInfo"] === undefined ? ko.observable() : ko.observable(localStorage["selfInfo"]);

	//#4 - list with people in the same neighborhood
	_self.viewNearPeople = new NearPeopleViewModel(5, "Pessoas próximas");

	//#5 - selecting stickers you want and you are giving
	_self.viewExchangingArena = new ExchangingArenaViewModel(6, "Trocando Figurinhas");

	// /END OF views ~ <section>

	//section interaction ~ <article>
	//#1 - first time the app is loaded interaction
	selectNeededStickersState = new InteractionModelState(_self.viewNeededStickers, null, "avançar");	
	selectAvailableStickersState = new InteractionModelState(_self.viewAvailableStickers, "voltar", "concluir");
	_self.interactionWelcome = new InteractionModel(_self, 1, selectNeededStickersState);	
	_self.interactionWelcome.addTransition(selectNeededStickersState, selectAvailableStickersState, "confirm");
	_self.interactionWelcome.addTransition(selectAvailableStickersState, selectNeededStickersState, "cancel");
	_self.interactionWelcome.addTransition(selectAvailableStickersState, null, "confirm", function() {
		_self.firstTimeRunning(false);
		localStorage["firstTimeFlag"] = 0;
	});

	//#2 - checking the stickers needed to complete the collection allowing to mark the ones got to remove them from the list
	selectNeededStickersStateNoAction = new InteractionModelState(_self.viewNeededStickers);
	_self.interactionNeededStickers = new InteractionModel(_self, 2, selectNeededStickersStateNoAction);

	//#3 - checking the stickers that are available to exchange allowing to mark the ones that are no available anymore to remove them from the list
	selectAvailableStickersStateNoAction = new InteractionModelState(_self.viewAvailableStickers);
	_self.interactionAvailableStickers = new InteractionModel(_self, 3, selectAvailableStickersStateNoAction);

	//#4 - connect (if not), locate people, choose one and exchange the stickers by marking the ones the user will got from the other peer and the ones the user is giving
	connectingState = new InteractionModelState(_self.viewConnect);
	chosingPeerState = new InteractionModelState(_self.viewNearPeople, "desconectar");
	exchangingState = new InteractionModelState(_self.viewExchangingArena, "voltar");
	_self.interactionExchangeNow = new InteractionModel(_self, 4, connectingState);
	_self.interactionExchangeNow.addTransition(connectingState, chosingPeerState, "connected");
	_self.interactionExchangeNow.addTransition(chosingPeerState, exchangingState, "exchange");
	_self.interactionExchangeNow.addTransition(chosingPeerState, connectingState, "cancel", function() {
		if(_self.mqttConnectionManager.isMaintainingConnectionToServer()) {
			_self.mqttConnectionManager.disconnectFromServer();
		}
	});
	_self.interactionExchangeNow.addTransition(exchangingState, chosingPeerState, "cancel");
	
	_self.viewNearPeople.selectedPeer.subscribe(function(newValue) {
		if (newValue!=null) {
			_self.viewExchangingArena.currentPeer(newValue);
			_self.interactionExchangeNow.triggerTransition("exchange");
		}
	});
	_self.mqttConnected.subscribe(function(newValue) { 
		if (newValue) {
			_self.interactionExchangeNow.triggerTransition("connected");
		}else{
			_self.interactionExchangeNow.triggerTransition("cancel");
		}
	});

	//checks if it is first time running the App
	_self.firstTimeRunning = ko.observable(localStorage["firstTimeFlag"] == undefined ? true : false);
	_self.firstTimeRunning(false); //
	if (_self.firstTimeRunning()) {
		_self.currentInteraction = ko.observable(_self.interactionWelcome);
    } else if(localStorage["connectedToServer"]) {
		_self.currentInteraction = ko.observable(_self.interactionExchangeNow);
	} else {
		_self.currentInteraction = ko.observable(_self.interactionNeededStickers);
	}

	_self.openDefaultInteraction = function() {
		_self.currentInteraction(_self.interactionNeededStickers);
	}

	//update elapsed time informations
	window.setInterval(function() {
		//add time messages
		for(var i=0; i<_self.receivedStickersInfo.length; i++) {
 			var stickersInfo = _self.receivedStickersInfo[i];
			var info = "";
			var timeElapsed = new Date().getTime() - stickersInfo.time;
			if(timeElapsed < 60000) {
				info = "Há poucos segundos";
			} else if(timeElapsed < 3600000) {
				info = "Há "+ Math.ceil(timeElapsed/60000) +" minutos";
			} else if(timeElapsed >= 3600000) {
				info = "Há "+ Math.ceil(timeElapsed/3600000) +" horas";
			}
			stickersInfo.timeElapsedInfo(info);
		}
	}, 5000);


	_self.connectToMQTTServer = function() {
			//store info for later use
		localStorage["nickname"] = _self.viewConnect.nickname();
		localStorage["place"] = _self.viewConnect.place();
		localStorage["selfInfo"] = _self.viewConnect.selfInfo();

		//clear previous known people
		_self.receivedStickersInfo = new Array();
		_self.viewNearPeople.connectedPeople.removeAll();

		//connect to mqtt server
		_self.mqttConnectionManager.connectToServer();
	}

	_self.publishStickersInfoToServer = function(firstMessage) {
		if(_self.mqttConnectionManager.isMaintainingConnectionToServer()) {
			console.log("Preparing stickers info...");
			var stickersInfo = new StickersInfo(_self.clientUUID,
				new Date().getTime(),
				_self.viewConnect.nickname.peek(),
				_self.viewConnect.place.peek(),
				_self.viewConnect.selfInfo.peek(),
				_self.getOnlySelectedItems(_self.viewNeededStickers.items()),
				_self.getOnlySelectedItems(_self.viewAvailableStickers.items()),
				firstMessage
				//stickersForReceivingFromPeer: Array - used later during ranking calculations
				//stickersForGivingToPeer: Array - used later during ranking calculations
			);

			console.log("Publishing stickers info to MQTT server...");
			_self.mqttConnectionManager.publishMessage("/main/notclassified", JSON.stringify(stickersInfo));

		} else {
			console.log("Not connected to server");
		}
	}

	_self.getOnlySelectedItems = function(items) {
		var result = new Array();
		for(var i=0; i<items.length; i++) {
			if(items[i].selected()) {
				result.push(items[i]);
			}
		}
		return result;
	}

	_self.recalculateStickersInfoRanking = function() {
		if(_self.receivedStickersInfo!=null && _self.viewNeededStickers!=null && _self.viewAvailableStickers!=null) {

			//look for stickers that the current user needs and are available from others
			for(var i=0; i<_self.receivedStickersInfo.length; i++) {
				var receivedStickerInfo = _self.receivedStickersInfo[i];
				receivedStickerInfo.stickersForReceivingFromPeer = new Array();
				receivedStickerInfo.stickersForGivingToPeer = new Array();
		
				//find stickers that the current user could get from other peers
				var filteredNeedStickersModelItems = _self.getOnlySelectedItems(_self.viewNeededStickers.items());
				for(var j=0; j<filteredNeedStickersModelItems.length; j++) {
					var neededStickerByUser = filteredNeedStickersModelItems[j];
			
					for(var k=0; k<receivedStickerInfo.availableStickers.length; k++) {
						var availableStickerFromPeer = receivedStickerInfo.availableStickers[k];
						if(neededStickerByUser.number==availableStickerFromPeer.number) {
							receivedStickerInfo.stickersForReceivingFromPeer.push(neededStickerByUser);
							break;
						}
					}
				}

				//find stickers that the current user could give to other peers
				var filteredAvailableStickersModelItems = _self.getOnlySelectedItems(_self.viewAvailableStickers.items());
				for(var j=0; j<filteredAvailableStickersModelItems.length; j++) {
					var availableStickerByUser = filteredAvailableStickersModelItems[j];
			
					for(var k=0; k<receivedStickerInfo.neededStickers.length; k++) {
						var neededStickerFromPeer = receivedStickerInfo.neededStickers[k];
						if(availableStickerByUser.number==neededStickerFromPeer.number) {
							receivedStickerInfo.stickersForGivingToPeer.push(availableStickerByUser);
							break;
						}
					}
				}
			}

			//order ranking by best matches
			if(_self.receivedStickersInfo.length>0) {
				_self.receivedStickersInfo.sort(function(left,right) {
					if(left.stickersForReceivingFromPeer.length > right.stickersForReceivingFromPeer.length) {
						return -1;
					} else {
						return 1;
					}
				});
				
				//update screen items
				_self.viewNearPeople.connectedPeople.removeAll();
				for(var i=0; i<_self.receivedStickersInfo.length; i++) {
					_self.viewNearPeople.connectedPeople.push(_self.receivedStickersInfo[i]);
				}
			}
		}
				
	}

}

//***** /end of VIEW VIEWMODELS ******//
