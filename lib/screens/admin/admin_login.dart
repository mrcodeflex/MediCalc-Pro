
import 'package:flutter/material.dart'; import '../../services/pin_service.dart';
class AdminLoginScreen extends StatefulWidget{ @override _AdminLoginScreenState createState()=>_AdminLoginScreenState(); }
class _AdminLoginScreenState extends State<AdminLoginScreen>{ final ctrl=TextEditingController(); String? err; bool loading=false;
 void _login() async{ setState(()=>loading=true); final ok = await PinService.verifyPin(ctrl.text.trim()); setState(()=>loading=false); if(ok) Navigator.pushNamed(context,'/admin/dashboard'); else setState(()=>err='Invalid PIN'); }
 @override Widget build(BuildContext c){ return Scaffold(appBar:AppBar(title:Text('Admin Login')), body:Padding(padding:EdgeInsets.all(16), child:Column(children:[ TextField(controller:ctrl, obscureText:true, decoration:InputDecoration(labelText:'Admin PIN')), if(err!=null) Text(err!, style:TextStyle(color:Colors.red)), SizedBox(height:12), ElevatedButton(onPressed:loading?null:_login, child:Text('Login')) ]))); }
}
