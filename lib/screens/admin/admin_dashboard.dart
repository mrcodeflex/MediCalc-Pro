
import 'package:flutter/material.dart'; import '../../services/calculator_service.dart'; import '../../services/db_service.dart'; import 'package:uuid/uuid.dart';
class AdminDashboardScreen extends StatefulWidget{ @override _AdminDashboardState createState()=>_AdminDashboardState(); }
class _AdminDashboardState extends State<AdminDashboardScreen>{ final n=TextEditingController(), c=TextEditingController(), d=TextEditingController(); List<Map<String,dynamic>> list=[];
 @override void initState(){ super.initState(); _load(); }
 void _load() async{ list = await CalculatorService.loadCalculators(); setState(()=>{}); }
 void _add(){ if(n.text.trim().isEmpty) return; final id=Uuid().v4(); DbService.getDb().then((db)=> db.insert('calculators', {'id':id,'name':n.text.trim(),'category':c.text.trim(),'description':d.text.trim(),'formula':'','fields':'[]','isPremium':0,'createdAt':DateTime.now().toIso8601String()})); n.clear(); c.clear(); d.clear(); _load(); ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('Added'))); }
 @override Widget build(BuildContext ctx){ return Scaffold(appBar:AppBar(title:Text('Admin Dashboard')), body:Padding(padding:EdgeInsets.all(12), child:Column(children:[ Text('Count: ${list.length}'), Expanded(child:ListView.builder(itemCount:list.length,itemBuilder:(i,idx)=>ListTile(title:Text(list[idx]['name'] ?? '')))), Divider(), TextField(controller:n, decoration:InputDecoration(labelText:'Name')), TextField(controller:c, decoration:InputDecoration(labelText:'Category')), TextField(controller:d, decoration:InputDecoration(labelText:'Description')), ElevatedButton(onPressed:_add, child:Text('Add Calculator')), ElevatedButton(onPressed:()=>Navigator.pushNamed(context,'/admin/change_pin'), child:Text('Change PIN')) ]))); }
}
