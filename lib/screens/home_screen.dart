
import 'package:flutter/material.dart'; import '../services/calculator_service.dart';
class HomeScreen extends StatefulWidget{ @override _HomeScreenState createState()=>_HomeScreenState(); }
class _HomeScreenState extends State<HomeScreen>{
  List<Map<String,dynamic>> _calcs=[];
  @override void initState(){ super.initState(); _load(); }
  void _load() async { _calcs = await CalculatorService.loadCalculators(); setState(()=>{}); }
  @override Widget build(BuildContext c){ return Scaffold(appBar:AppBar(title:Text('MediCalc Pro')), body:ListView.builder(padding:EdgeInsets.all(12), itemCount:_calcs.length, itemBuilder:(ctx,i){ final c=_calcs[i]; return Card(child:ListTile(title:Text(c['name']), subtitle:Text(c['category']), onTap:()=>Navigator.pushNamed(context,'/calc',arguments:c))); }), floatingActionButton:FloatingActionButton(child:Icon(Icons.admin_panel_settings), onPressed:()=>Navigator.pushNamed(context,'/admin/login'))); }
}
