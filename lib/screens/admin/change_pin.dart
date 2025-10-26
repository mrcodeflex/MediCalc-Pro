
import 'package:flutter/material.dart'; import '../../services/pin_service.dart';
class ChangePinScreen extends StatefulWidget{ @override _ChangePinState createState()=>_ChangePinState(); }
class _ChangePinState extends State<ChangePinScreen>{ final o=TextEditingController(), n=TextEditingController(), cf=TextEditingController(); String? msg;
 void _update() async{ setState(()=>msg=null); if(n.text!=cf.text){ setState(()=>msg='Mismatch'); return;} final ok = await PinService.changePin(oldPin:o.text.trim(), newPin:n.text.trim()); setState(()=> msg = ok? 'Updated':'Current PIN incorrect'); }
 @override Widget build(BuildContext c){ return Scaffold(appBar:AppBar(title:Text('Change PIN')), body:Padding(padding:EdgeInsets.all(16), child:Column(children:[ TextField(controller:o, obscureText:true, decoration:InputDecoration(labelText:'Current PIN')), TextField(controller:n, obscureText:true, decoration:InputDecoration(labelText:'New PIN')), TextField(controller:cf, obscureText:true, decoration:InputDecoration(labelText:'Confirm')), ElevatedButton(onPressed:_update, child:Text('Update')), if(msg!=null) Text(msg!) ]))); }
}
