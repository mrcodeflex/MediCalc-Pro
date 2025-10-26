
import 'package:flutter/material.dart';
import '../services/calculator_service.dart';
class HomeScreen extends StatefulWidget{ @override _HomeScreenState createState()=>_HomeScreenState(); }
class _HomeScreenState extends State<HomeScreen>{ List<Map<String,dynamic>> _calcs=[];
  @override void initState(){ super.initState(); _load(); }
  void _load() async { _calcs = await CalculatorService.loadCalculators(); setState(()=>{}); }
  @override Widget build(BuildContext c){ return Scaffold(appBar:AppBar(title:Text('MediCalc Pro')), body:Padding(padding:EdgeInsets.all(12), child:Column(children:[ Text('Calculators', style: Theme.of(context).textTheme.headline6), SizedBox(height:8), Expanded(child:ListView.builder(itemCount:_calcs.length, itemBuilder:(ctx,i){ final m=_calcs[i]; return Card(child:ListTile(title:Text(m['name']), subtitle:Text(m['category']), onTap:()=>Navigator.pushNamed(context,'/calc', arguments: m))); })), SizedBox(height:8), ElevatedButton(child:Text('Admin Login'), onPressed: ()=>Navigator.pushNamed(context,'/admin/login')) ]))); }
}
