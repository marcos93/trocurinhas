/** MODEL VIEW VIEWMODEL * */
// constructor
function AppModel() {
	// initialize needed and available stickers model
	var _defaultItems1 = new Array();
	for ( var i = 1; i <= 600; i++) {
		_defaultItems1.push({
			number : i,
			selected : false
		});
	}

	var _defaultItems2 = new Array();
	for ( var i = 1; i <= 600; i++) {
		_defaultItems2.push({
			number : i,
			selected : false
		});
	}

	// create and store an uid for this application for later reuse
	this.clientUUID = localStorage["clientUUID"];
	if (this.clientUUID == null) {
		this.clientUUID = generateUUID();
		localStorage["clientUUID"] = this.clientUUID;
	}

	var _self = this;
	this.neededStickersModel = new SelectableItemsModel("needed-stickers", _defaultItems1);
	this.neededStickersModel.subscribeToChanges(function() {_self.publishStickersInfoToServer()});
	this.neededStickersModel.subscribeToChanges(function() {_self.recalculateStickersInfoRanking()});
	
	this.availableStickersModel = new SelectableItemsModel("available-stickers", _defaultItems2);
	this.availableStickersModel.subscribeToChanges(function() {_self.publishStickersInfoToServer()});
	this.availableStickersModel.subscribeToChanges(function() {_self.recalculateStickersInfoRanking()});

	this.mqttClient = null;
	this.mqttConnected = false;
	this.mainTopicName = "/main/notclassified";

	this.nickname = ko.observable(localStorage["nickname"]);
	this.place = ko.observable(localStorage["place"]);
	this.selfInfo = ko.observable(localStorage["selfInfo"]);

	this.receivedStickersInfo = new Array();
	this.receivedStickersScreen = ko.observableArray();
	
	this.selectedReceivedStickersInfo = null;
	
	//update elapsed time informations
	var _self = this;
	window.setInterval(function() {
		//add time messages
		for(var i=0; i<_self.receivedStickersInfo.length; i++) {
			var stickersInfo = _self.receivedStickersInfo[i];
			var info = "";
			var timeElapsed = new Date().getTime() - stickersInfo.time;
			if(timeElapsed < 60000) {
				info = "H� poucos segundos";
			} else if(timeElapsed < 3600000) {
				info = "H� "+ Math.ceil(timeElapsed/60000) +" minutos";
			} else if(timeElapsed >= 3600000) {
				info = "H� "+ Math.ceil(timeElapsed/3600000) +" horas";
			}
			stickersInfo.timeElapsedInfo(info);
		}
	}, 5000);
}

AppModel.prototype.connectAndPublishSelfInfo = function() {
	var _self = this;
	this.connectToMQTTServer(this.mainTopicName, function() {
		_self.publishStickersInfoToServer();
	});
}

AppModel.prototype.publishStickersInfoToServer = function() {
	if(this.mqttConnected) {
		console.log("Preparing stickers info...");
		var _self = this;
		var stickersInfo = {
			clientUUID: _self.clientUUID,
			time: new Date().getTime(),
			nickname: _self.nickname.peek(),
			place: _self.place.peek(),
			selfInfo: _self.selfInfo.peek(),
			neededStickers: AppModel.getOnlySelectedItems(_self.neededStickersModel.items),
			availableStickers: AppModel.getOnlySelectedItems(_self.availableStickersModel.items)
			//stickersForReceivingFromPeer: Array - used later during ranking calculations
			//stickersForGivingToPeer: Array - used later during ranking calculations
		}
		console.log("Publishing stickers info to MQTT server...");
		this.publishToMQTTServer(this.mainTopicName, JSON.stringify(stickersInfo));
	} else {
		console.log("Not connected to server");
	}
}
AppModel.getOnlySelectedItems = function(items) {
	var result = new Array();
	for(var i=0; i<items.length; i++) {
		if(items[i].selected()) {
			result.push(items[i]);
		}
	}
	return result;
}

AppModel.prototype.disconnectFromMQTTServer = function() {
	if(this.mqttClient!=null) {
		console.log("Disconnecting from MQTT server...");
		try {
			this.mqttClient.disconnect();
			this.mqttClient = null;
			this.mqttConnected = false;
			this.showResultados();
		} catch (e) {
			console.log(e);
		}
	}
}

AppModel.prototype.connectToMQTTServer = function(mainTopicName, onSuccess) {
	//store info for later use
	localStorage["nickname"] = this.nickname();
	localStorage["place"] = this.place();
	localStorage["selfInfo"] = this.selfInfo();

	//connect to mqtt server
	var _self = this;
	this.disconnectFromMQTTServer();
	this.mqttClient = new Messaging.Client("gostutz.com", 61623, new Date().getTime()+"");
	var options = {
		timeout : 10,
		onSuccess : function() {
			try {
				_self.mqttConnected = true;
				console.log("Subscribing to '"+mainTopicName+"'...");
				_self.mqttClient.subscribe(mainTopicName);
				if(onSuccess) {
					onSuccess.call();
				}
				_self.showPessoas();
			} catch (e) {
				console.log(e);
			}
		},
		onFailure : function(responseObject) {
			_self.mqttConnected = false;
			console.log("Failure:"+responseObject.errorCode+" "+responseObject.errorMessage);
		},
		userName: "user",
		password: "user",
		useSSL: false
	};
	var _self = this;
	this.mqttClient.onMessageArrived = function(message) {
		try {
			console.log("Message arrived: " + message.payloadString);
			stickersInfo = JSON.parse(message.payloadString);
			stickersInfo.timeElapsedInfo = ko.observable("H� poucos segundos");
			
			//remove previous results from peer
			var index = -1;
			for(var i=0; i<_self.receivedStickersInfo.length; i++) {
				if(stickersInfo.clientUUID==_self.receivedStickersInfo[i].clientUUID) {
					index = i;
				}
			}
			
			if(index > -1) {
				_self.receivedStickersInfo.splice(index,1);
			}
			
			_self.receivedStickersInfo.push(stickersInfo);
			_self.recalculateStickersInfoRanking();
		} catch(e) {
			console.log(e);
		}
	};
	this.onConnectionLost = function(message) {
		console.log("Connection lost:"+message.errorCode + " " +responseObject.errorMessage);
	};

	console.log("Connecting to MQTT server...");
	this.mqttClient.connect(options);
}
AppModel.prototype.publishToMQTTServer = function(topicName, payload) {
	var message = new Messaging.Message(payload);
	message.destinationName = topicName;
	this.mqttClient.send(message); 
}

//perform balance line matches and ranking seeking for the best people that could exchange stickers with the user
AppModel.prototype.recalculateStickersInfoRanking = function() {
	if(this.receivedStickersInfo!=null && this.neededStickersModel!=null && this.availableStickersModel!=null) {

		//look for stickers that the current user needs and are available from others
		for(var i=0; i<this.receivedStickersInfo.length; i++) {
			var receivedStickerInfo = this.receivedStickersInfo[i];
			receivedStickerInfo.stickersForReceivingFromPeer = new Array();
			receivedStickerInfo.stickersForGivingToPeer = new Array();
	
			//find stickers that the current user could get from other peers
			for(var j=0; j<this.neededStickersModel.items.length; j++) {
				var neededStickerByUser = this.neededStickersModel.items[j];
		
				for(var k=0; k<receivedStickerInfo.availableStickers.length; k++) {
					var availableStickerFromPeer = receivedStickerInfo.availableStickers[k];
					if(neededStickerByUser.number==availableStickerFromPeer.number && neededStickerByUser.selected()) {
						receivedStickerInfo.stickersForReceivingFromPeer.push({number: availableStickerFromPeer.number, selected:true});
					}
				}
			}

			//find stickers that the current user could give to other peers
			for(var j=0; j<this.availableStickersModel.items.length; j++) {
				var availableStickerByUser = this.availableStickersModel.items[j];
		
				for(var k=0; k<receivedStickerInfo.neededStickers.length; k++) {
					var neededStickerFromPeer = receivedStickerInfo.neededStickers[k];
					if(availableStickerByUser.number==neededStickerFromPeer.number && availableStickerByUser.selected()) {
						receivedStickerInfo.stickersForGivingToPeer.push({number: availableStickerByUser.number, selected:true});
					}
				}
			}
		}

		//order ranking by best matches
		if(this.receivedStickersInfo.length>0) {
			this.receivedStickersInfo.sort(function(left,right) {
				if(left.stickersForReceivingFromPeer.length > right.stickersForReceivingFromPeer.length) {
					return 1;
				} else {
					return -1;
				}
			});
			
			//update screen items
			this.receivedStickersScreen.removeAll();
			for(var i=0; i<this.receivedStickersInfo.length; i++) {
				this.receivedStickersScreen.push(this.receivedStickersInfo[i]);
			}
		}
	}

}

AppModel.prototype.showSection = function(name) {
	document.getElementById("figurinhas-procuradas").style.display = "none";
	document.getElementById("figurinhas-repetidas").style.display = "none";
	document.getElementById("formulario-conexao").style.display = "none";
	document.getElementById("lista-matches").style.display = "none";
	document.getElementById(name).style.display = "block";
}
AppModel.prototype.showResultados = function() {
	if (!this.mqttConnected) {
		this.showSection("formulario-conexao");
	} else {
		this.showSection("lista-matches");
	}
}
AppModel.prototype.showPessoas = function() {
	this.showSection("lista-matches");
	document.getElementById("pessoas").style.display = "block";
	document.getElementById("arena-troca").style.display = "none";
}
AppModel.prototype.showArenaTroca = function(stickerInfo) {
	var _self = this;
	_self.selectedReceivedStickersInfo = stickerInfo;
	_self.showSection("lista-matches");
	document.getElementById("pessoas").style.display = "none";
	document.getElementById("arena-troca").style.display = "block";
}






/** SELECTABLE ITEMS MODEL * */
function SelectableItemsModel(storageName0, defaultItems) {
	var _self = this;
	_self.items = new Array();
	_self._observable = ko.observable(0);
	_self._dirty = false;
	storageName = storageName0;

	// recover previous selected state from storage
	var _plainItems = defaultItems;
	if(storageName!=null) {
		var _storedJson = localStorage[storageName + "-items"];
		if (_storedJson != null) {
			var resItems = JSON.parse(_storedJson);
			if (resItems != null && resItems.length > 0) {
				_plainItems = resItems;
			}
		}
	}

	// transform plain items array to observable
	for ( var i = 0; i < _plainItems.length; i++) {
		var oi = SelectableItemsModel._createObservableItem(
				_plainItems[i].number, _plainItems[i].selected, this);
		_self.items.push(oi);
	}

	// store changes locally and notify peers from time to time when something
	// has changed
	window.setInterval(function() {
		if (_self._dirty) {
			// store changes locally
			var recItems = new Array();
			for ( var i = 0; i < _self.items.length; i++) {
				recItems.push({
					number : _self.items[i].number,
					selected : _self.items[i].selected()
				});
			}
			if(storageName!=null) {
				localStorage[storageName + "-items"] = JSON.stringify(recItems);
			}

			// notify listeners about changes
			_self._observable(new Date().getTime());

			_self._dirty = false;
		}
	}, 3000);

}

SelectableItemsModel.prototype.subscribeToChanges = function(callbackFunction) {
	this._observable.subscribe(callbackFunction);
};

SelectableItemsModel.prototype.toggleSelection = function(item) {
	item.selected(!item.selected());
};

SelectableItemsModel._createObservableItem = function(itemNumber, itemSelected,
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
