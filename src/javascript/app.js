Ext.define("TSTimeInState", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },
    
    layout: 'border',
    
    items: [
        {xtype:'container',itemId:'selector_box', region:'north', layout: 'hbox', defaults: { margin: 10 }},
        {xtype:'container',itemId:'display_box', region: 'center', layout: 'fit'}
    ],

    integrationHeaders : {
        name : "TSTimeInState"
    },
                        
    launch: function() {
        this._addSelectors();
    },
    
    _addSelectors: function() {
        var container = this.down('#selector_box');
        container.removeAll();
        
        var field_chooser_box = container.add({
            xtype:'container'
        });
        
        var state_chooser_box = container.add({
            xtype:'container',
            layout: 'vbox'
        });
         
        var date_chooser_box = container.add({
            xtype:'container',
            layout: 'vbox'
        });
        
        field_chooser_box.add({
            xtype:'rallyfieldcombobox',
            model:'HierarchicalRequirement',
            _isNotHidden: this._isNotHidden,
            stateful: true,
            stateId: 'techservices-timeinstate-fieldcombo',
            stateEvents:['change'],
            listeners: {
                scope: this,
                change: function(cb) {
                    this._addStateSelectors(state_chooser_box, cb.getValue());
                }
            }
        });
        
        //this._addDateSelectors(date_chooser_box);
        
        container.add({ xtype:'container', flex: 1});
        container.add({ 
            xtype:'rallybutton', 
            text: 'Update', 
            padding: 3,
            listeners: {
                scope: this,
                click: this._updateData
            }
        });
        
        container.add({
            xtype:'rallybutton',
            itemId:'export_button',
            cls: 'secondary small',
            text: '<span class="icon-export"> </span>',
            disabled: true,
            listeners: {
                scope: this,
                click: function() {
                    this._export();
                }
            }
        });
    },
    
    _addStateSelectors: function(container, field_name) {
        container.removeAll();
        this.state_field_name = field_name;
        var label_width = 60;
        
        container.add({
            xtype:'rallyfieldvaluecombobox',
            model: 'HierarchicalRequirement',
            itemId: 'start_state_selector',
            field: field_name,
            fieldLabel: 'Start State:',
            labelWidth: label_width
        });
        
        container.add({
            xtype:'rallyfieldvaluecombobox',
            model: 'HierarchicalRequirement',
            itemId: 'end_state_selector',
            field: field_name,
            fieldLabel: 'End State:',
            labelWidth: label_width
        });
    },
    
    _addDateSelectors: function(container) {
        container.removeAll();
        var label_width = 60;
        
        container.add({
            xtype:'rallydatefield',
            itemId: 'start_date_selector',
            fieldLabel: 'Start Date:',
            labelWidth: label_width
        });
        
        container.add({
            xtype:'rallydatefield',
            itemId: 'end_date_selector',
            fieldLabel: 'End Date:',
            labelWidth: label_width
        });
    },
    
      
    _isNotHidden: function(field) {
        if ( field.hidden ) {
            return false;
        }
        var attributeDefn = field.attributeDefinition;
        
        if ( Ext.isEmpty(attributeDefn) ) {
            return false;
        }
        
        if ( attributeDefn.AttributeType == "STATE" ) {
            return true;
        }
        
        if ( attributeDefn.AttributeType == "STRING" && attributeDefn.Constrained == true) {
            return true;
        }
        //this.logger.log(field);

        return false;
    },
    
    _updateData: function() {
        var model = 'HierarchicalRequirement';
        var field_name = this.state_field_name;
        this.down('#export_button').setDisabled(true);
        
        this.startState = this.down('#start_state_selector').getValue();
        this.endState   = this.down('#end_state_selector').getValue();
        
        this.logger.log('start/end state', this.startState, this.endState);
        if ( Ext.isEmpty(this.startState) || Ext.isEmpty(this.endState) ) {
            return;
        }
        
        Deft.Chain.pipeline([
            function() { return this._setValidStates('HierarchicalRequirement', field_name) },
            function(states) { return this._getChangeSnapshots(field_name, "HierarchicalRequirement"); },
            this._addProjectsToSnapshots,
            this._organizeSnapshotsByOid,
            function(snaps_by_oid) { return this._setTimeInStatesForAll(snaps_by_oid, field_name); }
        ],this).then({
            scope: this,
            success: function(rows_by_oid) {
                var rows = Ext.Object.getValues(rows_by_oid);

                this._makeGrid(rows);
            },
            failure: function(msg) {
                Ext.Msg.alert('Problem loading data', msg);
            }
            
        });
    },
    
    _setTimeInStatesForAll: function(snaps_by_oid,field_name) {
        var rows_by_oid = {},
            me = this;
        Ext.Object.each(snaps_by_oid, function(key, snaps) {
            rows_by_oid[key] = me._calculateTimeInState(snaps,field_name);
        });
        return rows_by_oid;
    },
    
    _calculateTimeInState: function(snapshots, field_name) {
        var me = this;
        
        var entries = {};  // date of entry into state, used for calc
        var last_index = snapshots.length-1;
        
        var row = {
            snapshots: snapshots,
            FormattedID: snapshots[last_index].get('FormattedID'),
            Name: snapshots[last_index].get('Name'),
            Project: snapshots[last_index].get('Project'),
            __ProjectName: snapshots[last_index].get('__ProjectName'),
            __Project: snapshots[last_index].get('__Project')
        };
                
        Ext.Array.each(this.allowedStates, function(state){
            row[state] = 0;
            entries[state] = null;
            row['firstEntry_' + state] = null;
            row['lastExit_' + state] = null;
        });
        
        Ext.Array.each(snapshots,function(snap){
            var in_state = snap.get(field_name);
            var snap_time = snap.get('_ValidFrom');
            
            entries[in_state] = snap_time;
            row['lastExit_' + in_state] = null; // clear out for re-entry
            
            if ( Ext.isEmpty(row['firstEntry_' + in_state]) ) {
                row['firstEntry_' + in_state] = snap_time;
            }
            
            var out_state = snap.get('_PreviousValues.' + field_name);

            if ( ! Ext.isEmpty(entries[out_state]) ) {
                var jsStart = Rally.util.DateTime.fromIsoString(entries[out_state]);
                var jsEnd   = Rally.util.DateTime.fromIsoString(snap_time);
                
                var delta = Rally.util.DateTime.getDifference(jsEnd, jsStart, 'minute');

                row[out_state] = row[out_state] + delta;
                row['lastExit_' + out_state] = snap_time;
            }
        });
        
        return row;
    },
    _setValidStates: function(model_name, field_name) {
        var deferred = Ext.create('Deft.Deferred'),
            me = this;
        
        Rally.data.ModelFactory.getModel({
            type: model_name,
            success: function(model) {
                model.getField(field_name).getAllowedValueStore().load({
                    callback: function(records, operation, success) {
                        me.allowedStates = Ext.Array.map(records, function(allowedValue) {
                            //each record is an instance of the AllowedAttributeValue model 
                           return allowedValue.get('StringValue');
                        });
                        
                        deferred.resolve(me._allowedStates);
                    }
                });
            }
        });
        return deferred.promise;
    },
    
    _organizeSnapshotsByOid: function(snapshots) {
        var snapshots_by_oid = {};
        
        Ext.Array.each(snapshots, function(snap){
            var oid = snap.get('ObjectID');
            
            if ( Ext.isEmpty(snapshots_by_oid[oid]) ) {
                snapshots_by_oid[oid] = [];
            }
            
            snapshots_by_oid[oid].push(snap);
            
        });
        
        return snapshots_by_oid;
    },
    
    _getChangeSnapshots: function(field_name, model) {
        var change_into_states_filter = Ext.create('Rally.data.lookback.QueryFilter', {
            property: '_PreviousValues.' + field_name,
            operator: 'exists',
            value: true
        });
        
        var model_filter = Ext.create('Rally.data.lookback.QueryFilter', {
            property: '_TypeHierarchy',
            value: model
        });
        
        var project_filter = Ext.create('Rally.data.lookback.QueryFilter', {
            property: '_ProjectHierarchy',
            value: this.getContext().getProject().ObjectID
        });
        
        var filters = change_into_states_filter.and(model_filter).and(project_filter);
        
        var config = {
            filters: filters,
            fetch: ['ObjectID','FormattedID','Name','Project','_TypeHierarchy','_PreviousValues',field_name,'_PreviousValues.' + field_name],
            hydrate: ['ScheduleState','_PreviousValues.'+field_name]
        };
        
        return this._loadSnapshots(config);
    },
    
    _addProjectsToSnapshots: function(snapshots) {
        var deferred = Ext.create('Deft.Deferred'),
            me = this;
        var project_oids = Ext.Array.map(snapshots, function(snap){ return snap.get('Project')});
        
        var unique_project_oids = Ext.Array.unique(project_oids);
        
        var filters = Ext.Array.map(unique_project_oids, function(oid) {
            return { property:'ObjectID', value: oid };
        });
        
        var config = {
            model: 'Project',
            filters: Rally.data.wsapi.Filter.or(filters),
            fetch: ['ObjectID','Name'],
            limit: Infinity
        };
        
        this.setLoading('Loading Project Names...');
        
        this._loadWsapiRecords(config).then({
            success: function(projects) {
                var projects_by_oid = {};
                Ext.Array.each(projects, function(project){
                    var oid = project.get('ObjectID');
                    projects_by_oid[oid] = project;
                });
                
                Ext.Array.each(snapshots, function(snap){
                    var oid = snap.get('Project');
                    if ( !Ext.isEmpty(projects_by_oid[oid])) {
                        snap.set('__Project',projects_by_oid[oid].getData());
                        snap.set('__ProjectName', projects_by_oid[oid].get('Name'));
                    } else {
                        snap.set('__Project', {});
                        snap.set('__ProjectName', "");
                    }
                });
                me.setLoading(false);
                deferred.resolve(snapshots);
            },
            failure: function(msg) {
                deferred.reject(msg);
            }
        });
        
        return deferred.promise;
    },

    _loadSnapshots: function(config){
        var deferred = Ext.create('Deft.Deferred');
        var me = this;
        var default_config = {
            removeUnauthorizedSnapshots: true
        };
        
        this.setLoading('Loading history...');
        this.logger.log("Starting load:",config);
        
        Ext.create('Rally.data.lookback.SnapshotStore', Ext.Object.merge(default_config,config)).load({
            callback : function(records, operation, successful) {
                if (successful){
                    me.setLoading(false);
                    deferred.resolve(records);
                } else {
                    me.logger.log("Failed: ", operation);
                    deferred.reject('Problem loading: ' + operation.error.errors.join('. '));
                }
            }
        });
        return deferred.promise;
    },
    
    _loadWsapiRecords: function(config){
        var deferred = Ext.create('Deft.Deferred');
        var me = this;
        var default_config = {
            model: 'Defect',
            fetch: ['ObjectID']
        };
        this.logger.log("Starting load:",config.model);
        Ext.create('Rally.data.wsapi.Store', Ext.Object.merge(default_config,config)).load({
            callback : function(records, operation, successful) {
                if (successful){
                    deferred.resolve(records);
                } else {
                    me.logger.log("Failed: ", operation);
                    deferred.reject('Problem loading: ' + operation.error.errors.join('. '));
                }
            }
        });
        return deferred.promise;
    },

    _loadAStoreWithAPromise: function(model_name, model_fields){
        var deferred = Ext.create('Deft.Deferred');
        var me = this;
        this.logger.log("Starting load:",model_name,model_fields);
          
        Ext.create('Rally.data.wsapi.Store', {
            model: model_name,
            fetch: model_fields
        }).load({
            callback : function(records, operation, successful) {
                if (successful){
                    deferred.resolve(this);
                } else {
                    me.logger.log("Failed: ", operation);
                    deferred.reject('Problem loading: ' + operation.error.errors.join('. '));
                }
            }
        });
        return deferred.promise;
    },
    
    _makeGrid: function(rows){
        this.rows = rows;
        this.down('#export_button').setDisabled(false);

        var container = this.down('#display_box');
        container.removeAll();
        
        var store = Ext.create('Rally.data.custom.Store',{ data: rows });
        
        container.add({
            xtype: 'rallygrid',
            store: store,
            columnCfgs: this._getColumns()
        });
    },
    
    _getShowStates: function(allowed_states, start_state, end_state) {
        var start_index = Ext.Array.indexOf(allowed_states, start_state);
        var end_index   = Ext.Array.indexOf(allowed_states, end_state);
        
        // swap if chosen out of order
        if ( start_index > end_index ) {
            var holder = start_index;
            start_index = end_index;
            end_index = holder;
        }
        
        console.log(start_index, end_index, allowed_states, start_state, end_state);
        
        return ( 
            Ext.Array.filter(allowed_states, function(state,idx) {
                return ( idx >= start_index && idx <= end_index );
            })
        );
    },
    
    _getColumns: function() {
        var columns = [
            { dataIndex: 'FormattedID', text: 'id', width: 75 },
            { dataIndex: 'Name', text: 'Name', width: 200 },
            { dataIndex: '__ProjectName', text:'Project', width: 155 }
        ];
        
        var show_states = this._getShowStates(this.allowedStates, this.startState, this.endState);
        
        
        Ext.Array.each(show_states, function(state) {
            columns.push({
                dataIndex: state,
                text: state,
                align: 'right',
                renderer: function(value, meta, record) {
                    if ( Ext.isEmpty(value) ) { return ""; }
                    return Ext.Number.toFixed( value / 1440, 2 ); // it's in minutes
                }
            });
            
            columns.push({
                dataIndex: 'firstEntry_' + state,
                text: state + ' first entered',
                align: 'right',
                renderer: function(value, meta, record) {
                    if ( Ext.isEmpty(value) ) { return ""; }
                    return value;
                }
            });
            
            columns.push({
                dataIndex: 'lastExit_' + state,
                text: state + ' last exited',
                align: 'right',
                renderer: function(value, meta, record) {
                    if ( Ext.isEmpty(value) ) { return ""; }
                    return value;
                }
            });
        });
        return columns;
    },
    
    _export: function(){
        var me = this;
        this.logger.log('_export');
        
        var grid = this.down('rallygrid');
        var rows = this.rows;
        
        this.logger.log('number of rows:', rows.length);
        
        if ( !grid && !rows ) { return; }
        
        var filename = 'time-in-state-report.csv';

        this.logger.log('saving file:', filename);
        
        this.setLoading("Generating CSV");
        Deft.Chain.sequence([
            function() { return Rally.technicalservices.FileUtilities.getCSVFromRows(this,grid,rows); } 
        ]).then({
            scope: this,
            success: function(csv){
                this.logger.log('got back csv ', csv.length);
                if (csv && csv.length > 0){
                    Rally.technicalservices.FileUtilities.saveCSVToFile(csv,filename);
                } else {
                    Rally.ui.notify.Notifier.showWarning({message: 'No data to export'});
                }
                
            }
        }).always(function() { me.setLoading(false); });
    },
    
    getOptions: function() {
        return [
            {
                text: 'About...',
                handler: this._launchInfo,
                scope: this
            }
        ];
    },
    
    _launchInfo: function() {
        if ( this.about_dialog ) { this.about_dialog.destroy(); }
        this.about_dialog = Ext.create('Rally.technicalservices.InfoLink',{});
    },
    
    isExternal: function(){
        return typeof(this.getAppId()) == 'undefined';
    },
    
    //onSettingsUpdate:  Override
    onSettingsUpdate: function (settings){
        this.logger.log('onSettingsUpdate',settings);
        // Ext.apply(this, settings);
        this.launch();
    }
});
