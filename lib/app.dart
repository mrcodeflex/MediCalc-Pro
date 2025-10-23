
import 'package:flutter/material.dart';
import 'screens/home_screen.dart';
import 'screens/calc_screen.dart';
import 'screens/admin/admin_login.dart';
import 'screens/admin/admin_dashboard.dart';
import 'screens/admin/change_pin.dart';
class MyApp extends StatelessWidget {
  @override Widget build(BuildContext c) {
    return MaterialApp(
      title:'MediCalc Pro',
      theme: ThemeData(primarySwatch: Colors.blue),
      initialRoute:'/',
      routes:{'/':(_)=>HomeScreen(), '/calc':(_)=>CalcScreen(), '/admin/login':(_)=>AdminLoginScreen(), '/admin/dashboard':(_)=>AdminDashboardScreen(), '/admin/change_pin':(_)=>ChangePinScreen()}
    );
  }
}
