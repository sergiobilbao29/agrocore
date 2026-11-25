# -*- coding: utf-8 -*-
"""Instructivo: Empleados y sueldos (PDF, estilo AgroCore)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Empleados-y-Sueldos.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=21, textColor=G900, spaceAfter=2, leading=25)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)
st_cell  = S("cell", fontName="Helvetica", fontSize=9, leading=12, textColor=colors.HexColor("#1f2937"))
st_cellb = S("cellb", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=G900)

def callout(text, bg, bd, tx):
    p = Paragraph(text, S("c", fontName="Helvetica", fontSize=10, leading=15, textColor=tx))
    t = Table([[p]], colWidths=[165*mm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),bg),("BOX",(0,0),(-1,-1),1.2,bd),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8)]))
    return t

def steps(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), value=i+1, leftIndent=6) for i,t in enumerate(items)],
        bulletType="1", bulletFontName="Helvetica-Bold", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=2, spaceAfter=2)

def bullets(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), leftIndent=6) for t in items],
        bulletType="bullet", bulletChar="•", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=1, spaceAfter=1)

def tabla(data, anchos):
    rows = []
    for r_i, row in enumerate(data):
        rows.append([Paragraph(c, st_cellb if r_i==0 else st_cell) for c in row])
    t = Table(rows, colWidths=anchos, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,0),G100),
        ("GRID",(0,0),(-1,-1),0.5,colors.HexColor("#cbd5e1")),
        ("VALIGN",(0,0),(-1,-1),"TOP"),
        ("LEFTPADDING",(0,0),(-1,-1),5),("RIGHTPADDING",(0,0),(-1,-1),5),
        ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
    ]))
    return t

def header_footer(canvas, doc):
    canvas.saveState(); w, h = A4
    canvas.setFillColor(G900); canvas.rect(0, h-24*mm, w, 24*mm, fill=1, stroke=0)
    try: canvas.drawImage(LOGO, 15*mm, h-21*mm, width=16*mm, height=13.7*mm, preserveAspectRatio=True, mask='auto')
    except Exception: pass
    canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 13); canvas.drawString(34*mm, h-15*mm, "AgroCore")
    canvas.setFont("Helvetica", 10); canvas.drawRightString(w-15*mm, h-15*mm, "Instructivo")
    canvas.setStrokeColor(G100); canvas.setLineWidth(0.6); canvas.line(15*mm, 15*mm, w-15*mm, 15*mm)
    canvas.setFillColor(SLATE); canvas.setFont("Helvetica", 8)
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazón del negocio agrícola")
    canvas.drawRightString(w-15*mm, 10*mm, "Página %d" % doc.page)
    canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Empleados y sueldos", st_title))
    E.append(Paragraph("Llevar la cuenta de cada empleado mes a mes: sueldo fijo o variable, labores con porcentaje, gastos y adelantos, entregas, y la liquidación con arrastre", st_sub))
    E.append(Paragraph(
        "Cada empleado tiene su <b>planilla mensual</b> (una cuenta corriente): arranca con el <b>sueldo del mes</b>, "
        "se le suman las <b>ganancias</b> (horas, días, premios, comisiones de labor) y se le restan los <b>gastos</b> "
        "(adelantos, compras personales, descuentos, días no trabajados). El resultado es el <b>neto del mes</b>, y "
        "con el <b>saldo que venía arrastrando</b> del mes anterior se arma el <b>total a pagar</b>. Cuando pagás, "
        "ponés lo que realmente transferís y la diferencia <b>queda como saldo</b> para el mes siguiente. "
        "Está todo en <b>Administración &rarr; Empleados</b>.", st_intro))
    E.append(callout("<b>La idea en una línea:</b> &nbsp; Saldo mes anterior &nbsp;+&nbsp; (Ganancias del mes &minus; Gastos del mes) "
                     "&nbsp;=&nbsp; <b>Total a pagar</b>. &nbsp; Pagás lo que quieras y el resto queda a favor o en contra para el mes que viene.",
                     G100, G600, G900))

    # PASO 1
    E.append(Paragraph("PASO 1 &nbsp;&mdash;&nbsp; Dar de alta al empleado", st_h2))
    E.append(Paragraph("En <b>Administración &rarr; Empleados</b> tocá <b>&#65291; Nuevo empleado</b> y completá:", st_intro))
    E.append(bullets([
        "<b>Datos personales:</b> nombre, apellido, DNI, CUIL, puesto y fecha de ingreso.",
        "<b>Datos de pago (opcional):</b> Alias, CBU y Banco &mdash; sirven para la <b>Planilla de pagos</b> (sale el alias al lado de cada sueldo, listo para transferir).",
        "<b>Modalidad de sueldo:</b> ahí definís si cobra un <b>sueldo fijo mensual</b> o <b>por día</b> (ver Paso 2).",
    ]))
    E.append(callout("Un <b>empleado</b> se puede <b>vincular</b> con un usuario del sistema y con un chofer. No hace falta para liquidar; "
                     "es útil cuando la misma persona maneja camiones (así la comisión del viaje le cae en la planilla).", BLUE_BG, BLUE_BD, BLUE_TX))

    # PASO 2 sueldo fijo / variable / por dia
    E.append(Paragraph("PASO 2 &nbsp;&mdash;&nbsp; Definir el sueldo (fijo, variable o por día)", st_h2))
    E.append(Paragraph("AgroCore contempla las tres formas de pagar que se usan en el campo:", st_intro))
    E.append(tabla([
        ["Modalidad", "Cómo se carga", "Cuándo usarla"],
        ["Sueldo fijo mensual", "En la ficha, campo <b>Sueldo</b>. Aparece solo todos los meses como base.",
         "Mensualizados con sueldo estable."],
        ["Por día (jornal)", "Tilde <b>Trabaja por día</b>: cargás el <b>precio por día (jornal)</b> y los <b>días por mes</b>. El sueldo del mes = jornal &times; días. Si dejás los días vacíos, toma el <b>mes completo</b> y después descontás los días no trabajados.",
         "Jornaleros / changas / temporarios."],
        ["Variable (cambia cada mes)", "Botón <b>&#128181; Sueldo del mes</b> dentro de la planilla: fijás el valor de <b>ese mes</b> y no te toca los meses ya cargados.",
         "Administración, acuerdos de comercio, aumentos."],
    ], [38*mm, 97*mm, 30*mm]))
    E.append(callout("<b>Sueldo variable, clave:</b> usá siempre <b>&#128181; Sueldo del mes</b> para los sueldos que cambian. "
                     "Si en cambio editás el sueldo fijo de la ficha, cambia la base de <b>todos</b> los meses &mdash; por eso, "
                     "para los que varían, conviene fijarlo mes por mes.", AMBER_BG, AMBER_BD, AMBER_TX))

    # PASO 3 planilla ganancias / gastos
    E.append(Paragraph("PASO 3 &nbsp;&mdash;&nbsp; Cargar la planilla del mes (ganancias y gastos)", st_h2))
    E.append(Paragraph("Entrá a la planilla del empleado (botón <b>&#128203; Ver planilla</b> o tocando su nombre). Arriba elegís el "
                       "<b>mes</b>. Con <b>&#65291; Movimiento</b> (o <b>&#10133; Cargar varios</b> para varias filas de una) sumás lo del mes. "
                       "Cada movimiento tiene una <b>categoría</b>, que puede ser de <b>monto fijo</b> o de <b>cantidad &times; valor</b>:", st_intro))
    E.append(tabla([
        ["Categoría", "Suma / Resta", "Tipo"],
        ["Horas trabajadas", "Suma (+)", "Cantidad de horas &times; valor hora"],
        ["Días trabajados", "Suma (+)", "Cantidad de días &times; jornal (se autocompleta)"],
        ["Sueldo", "Suma (+)", "Monto"],
        ["Premio / bono", "Suma (+)", "Monto"],
        ["Otro ingreso", "Suma (+)", "Monto"],
        ["Adelanto de dinero", "Resta (&minus;)", "Monto"],
        ["Compra / cosa personal", "Resta (&minus;)", "Monto"],
        ["Descuento", "Resta (&minus;)", "Monto"],
        ["Día no trabajado", "Resta (&minus;)", "Cantidad de días &times; jornal (se autocompleta)"],
        ["Otro gasto", "Resta (&minus;)", "Monto"],
    ], [52*mm, 38*mm, 75*mm]))
    E.append(bullets([
        "Las categorías de <b>cantidad &times; valor</b> (horas, días) te piden la cantidad y el valor unitario, y calculan el total solas.",
        "Con <b>&#9881;&#65039; Categorías</b> podés <b>agregar categorías propias</b> (ej: viáticos, bolsas, viajes) o sacar las que no uses. "
        "Cada una puede ser de monto fijo o de cantidad &times; valor con su unidad. Son por empresa.",
        "Cada movimiento lleva su <b>fecha</b> y un <b>concepto</b> (texto libre) para que quede claro de qué se trata.",
    ]))

    # PASO 4 labores con %
    E.append(Paragraph("PASO 4 &nbsp;&mdash;&nbsp; Labores con porcentaje (comisión del empleado)", st_h2))
    E.append(Paragraph("Cuando un empleado cobra un <b>porcentaje por la labor</b> que hace (siembra, pulverización, cosecha, etc.), "
                       "no hace falta cargarlo a mano en la planilla: se genera solo.", st_intro))
    E.append(steps([
        "Primero, en la ficha del empleado podés dejar cargado su <b>% por defecto</b> (el porcentaje que suele cobrar).",
        "En <b>Producción &rarr; Insumos y labores</b>, al cargar una labor usá el botón <b>&#128296; Labor avanzada</b>.",
        "Elegís el <b>empleado responsable</b>, el <b>tipo de precio</b> (por hectárea o total de la labor) y el <b>precio de referencia</b>. "
        "El <b>% del empleado</b> se precarga con el de la ficha (lo podés cambiar).",
        "El formulario te muestra en vivo la <b>base de cálculo</b> (ha &times; precio o precio total), la <b>ganancia del empleado</b> "
        "(base &times; %) y <b>en qué mes</b> va a aparecer en su planilla.",
        "Al guardar, se crea solo un movimiento de <b>ganancia tipo labor</b> en la planilla de ese mes. No hay que cargarlo aparte.",
    ]))
    E.append(callout("<b>Choferes que cobran por viaje:</b> si el empleado también es chofer, la <b>comisión del viaje</b> (un % o monto por carta de porte) "
                     "también le cae automáticamente en la planilla del mes. Así juntás sueldo + labores + viajes en un solo lugar.", BLUE_BG, BLUE_BD, BLUE_TX))

    # PASO 5 entregas / adelantos
    E.append(Paragraph("PASO 5 &nbsp;&mdash;&nbsp; Entregas, adelantos y compras", st_h2))
    E.append(Paragraph("Cuando cargás un <b>Adelanto de dinero</b> o una <b>Compra / cosa personal</b> (gastos de plata real), el formulario "
                       "muestra abajo la opción <b>&#128181; Pagar ahora desde caja/banco</b>. Esto es lo que conecta el adelanto con tu caja:", st_intro))
    E.append(steps([
        "Cargás el movimiento normal (Tipo: Gasto, Categoría: Adelanto de dinero, Monto, Concepto).",
        "Tildás <b>&#128181; Pagar ahora desde caja/banco</b> y elegís el <b>medio</b>: Efectivo (y la caja), Transferencia (y la cuenta bancaria), Cheque propio (nuevo) o "
        "<b>Cheque de terceros</b> que tengas en cartera (lo endosás al empleado y sale de la cartera).",
        "Al <b>Agregar</b>, el sistema hace dos cosas de una: lo <b>descuenta del sueldo</b> en la planilla <b>y</b> genera el "
        "<b>egreso real</b> en la caja/banco (sale la plata en Control de Efectivo / Bancos ese mismo día).",
        "Cuando a fin de mes <b>liquidás</b>, el adelanto ya está restado del neto, así que <b>pagás solo el resto</b>. No se descuenta dos veces.",
    ]))
    E.append(callout("<b>Importante:</b> si NO tildás &ldquo;Pagar ahora&rdquo;, el adelanto queda solo anotado en la planilla y la plata "
                     "recién sale al Registrar pago (como antes). Si lo tildás, la caja se descuenta al instante y el recibo del mes "
                     "queda por el neto real. Si después <b>borrás</b> el movimiento, se revierte también el egreso de caja/banco.", AMBER_BG, AMBER_BD, AMBER_TX))
    E.append(bullets([
        "<b>Compras / cosas personales</b> que le fiás (mercadería, combustible, un repuesto): misma lógica, categoría <b>Compra / cosa personal</b>.",
        "<b>Descuento</b> y <b>Día no trabajado</b> son <b>deducciones</b> (no mueven caja): no ofrecen el pago inmediato, solo restan del sueldo.",
        "<b>Entrega de ropa / elementos de trabajo:</b> en la ficha del empleado, sección de <b>entregas</b>, con <b>&#65291; Registrar entrega</b> "
        "anotás que le diste (ropa, botas, EPP) y la fecha. Es un <b>registro de control</b> (no descuenta plata del sueldo).",
    ]))
    E.append(callout("Diferencia importante: lo que le <b>descontás del sueldo</b> va como <b>gasto en la planilla</b> (adelanto, compra, descuento). "
                     "La <b>entrega de ropa/EPP</b> es solo un registro de que se la diste, no afecta el neto a pagar.", BLUE_BG, BLUE_BD, BLUE_TX))

    # PASO 6 cuenta corriente arrastre
    E.append(Paragraph("PASO 6 &nbsp;&mdash;&nbsp; La cuenta corriente con arrastre", st_h2))
    E.append(Paragraph("Arriba de la planilla, el recuadro verde muestra el <b>Saldo a pagar (con arrastre)</b>. Se calcula así:", st_intro))
    E.append(callout("<b>Saldo mes anterior</b> (a favor o en contra) &nbsp;+&nbsp; <b>Ganancias del mes</b> &nbsp;&minus;&nbsp; <b>Gastos del mes</b> "
                     "&nbsp;=&nbsp; <b>Total a pagar</b>.", G100, G600, G900))
    E.append(bullets([
        "Si el mes anterior le quedaste <b>debiendo</b>, ese saldo <b>a favor del empleado</b> se suma a este mes.",
        "Si el empleado quedó <b>debiendo</b> (le adelantaste de más), ese saldo <b>en contra</b> se resta de este mes.",
        "Es el mismo <b>cuadrito a favor / en contra</b> del Excel, pero lo lleva solo el sistema.",
    ]))

    # PASO 7 liquidar y pagar
    E.append(Paragraph("PASO 7 &nbsp;&mdash;&nbsp; Liquidar y registrar el pago", st_h2))
    E.append(steps([
        "Con la planilla del mes completa, tocá <b>Registrar pago</b> (liquidar).",
        "El sistema propone el <b>Total a pagar (con arrastre)</b>. En <b>Monto que pagás ahora</b> escribís lo que realmente vas a transferir: "
        "puede ser <b>igual, menos o más</b> que el total.",
        "Elegís <b>fecha</b> y <b>medio de pago</b>: Efectivo en caja, Cheque propio, Transferencia bancaria, Tarjeta, Intercompany (otra firma del grupo paga) o <b>➗ Combinado (dividido)</b>.",
        "Debajo ves el aviso: si pagás menos, <b>queda un saldo a favor</b> del empleado que pasa al mes siguiente; si pagás de más, "
        "<b>queda a favor tuyo</b> (el empleado queda debiendo). Confirmás la liquidación.",
    ]))
    E.append(bullets([
        "Según el medio, el pago <b>mueve la plata real</b>: egreso de la caja elegida, cheque propio que se genera en cartera, o la transferencia del banco.",
        "Al elegir <b>Transferencia</b> seleccionás la <b>cuenta bancaria</b>; el sistema genera el <b>egreso en Bancos</b> de esa cuenta (y lo revierte si anulás la liquidación).",
        "Si te equivocaste, entrá al mes y usá <b>Anular liquidación</b>: borra el pago generado y el mes queda sin liquidar para rehacerlo.",
        "Si <b>editás movimientos después de liquidar</b>, el sistema te avisa que <b>anules y vuelvas a liquidar</b> para que el arrastre quede bien.",
    ]))

    # PASO 8 recibo / excel / anual
    E.append(Paragraph("PASO 8 &nbsp;&mdash;&nbsp; Recibo de sueldo, Excel y resumen anual", st_h2))
    E.append(bullets([
        "<b>Recibo de sueldo (PDF):</b> genera el comprobante para imprimir y entregar. Muestra los haberes y descuentos del mes, el "
        "<b>Neto del mes</b>, el <b>saldo del mes anterior</b> (a favor o en contra) y el <b>TOTAL A PAGAR (con arrastre)</b>; si ya liquidaste, "
        "agrega lo <b>pagado</b> y el <b>saldo que pasa al mes siguiente</b> &mdash; así el empleado ve lo mismo que cobra.",
        "Además del <b>&#129517; Recibo</b>, el botón <b>&#128065; Detalle</b> muestra cómo se compone la liquidación (ganancias, gastos/adelantos, "
        "neto del mes, saldo del mes anterior y total a pagar).",
        "<b>Exportar a Excel:</b> baja la planilla del mes en .xlsx.",
        "<b>Planilla de pagos:</b> botón en la nómina que arma la lista de sueldos del <b>mes elegido</b> con el monto y el alias/CBU al lado, "
        "lista para imprimir y transferir; podés editar montos y sumar otros pagos que no sean de empleados.",
        "<b>Resumen anual:</b> cada empleado tiene total liquidado en el año, meses liquidados y promedio mensual, con el historial de liquidaciones.",
    ]))

    # EJEMPLO
    E.append(Paragraph("Ejemplo completo (un mes)", st_h2))
    E.append(Paragraph("Juan cobra por día. En el mes:", st_intro))
    E.append(tabla([
        ["Concepto", "Tipo", "Importe"],
        ["Saldo mes anterior (a favor de Juan)", "Arrastre +", "$ 20.000"],
        ["22 días trabajados &times; $ 25.000", "Ganancia +", "$ 550.000"],
        ["Premio por cosecha", "Ganancia +", "$ 50.000"],
        ["Comisión labor (pulverización, 8%)", "Ganancia + (auto)", "$ 40.000"],
        ["Adelanto de dinero", "Gasto &minus;", "$ 80.000"],
        ["2 días no trabajados &times; $ 25.000", "Gasto &minus;", "$ 50.000"],
        ["<b>Total a pagar (con arrastre)</b>", "", "<b>$ 530.000</b>"],
        ["Pago ahora por transferencia", "Pago", "$ 500.000"],
        ["Queda a favor de Juan (pasa al mes que viene)", "Saldo", "$ 30.000"],
    ], [92*mm, 38*mm, 35*mm]))

    # FAQ
    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("¿Cómo manejo un sueldo que cambia todos los meses?",
         "Usá el botón Sueldo del mes dentro de la planilla: fijá el valor de ese mes puntual. No edites el sueldo fijo de la ficha, porque eso cambia la base de todos los meses."),
        ("¿Y si el empleado trabaja por día (jornal)?",
         "En la ficha tildás Trabaja por día y cargás el jornal. Si dejás los días por mes vacíos, toma el mes completo y después descontás los días no trabajados con esa categoría. Si cargás los días, usá jornal x días."),
        ("¿Cómo cargo las labores que cobra por porcentaje?",
         "Desde Producción > Insumos y labores con Labor avanzada: elegís el empleado, el precio de referencia y el %, y se genera solo un movimiento de ganancia en su planilla del mes."),
        ("¿El adelanto que le di se descuenta solo?",
         "Sí. Lo cargás como gasto Adelanto de dinero y resta del neto del mes. Si no alcanza, el saldo en contra pasa al mes siguiente."),
        ("¿La entrega de ropa descuenta del sueldo?",
         "No. La entrega de ropa/EPP es un registro de control. Lo que descuenta del sueldo son los gastos de la planilla (adelanto, compra personal, descuento)."),
        ("¿Qué pasa si le pago menos que el total?",
         "Queda un saldo a favor del empleado que se suma automáticamente al mes siguiente. Si le pagás de más, queda a favor tuyo (el empleado queda debiendo)."),
        ("Edité un movimiento de un mes que ya había liquidado, ¿qué hago?",
         "El sistema te avisa. Entrá a ese mes, Anulá la liquidación y volvé a liquidar para que el neto y el arrastre queden bien."),
        ("¿Puedo agregar categorías propias (viáticos, bolsas, viajes)?",
         "Sí, con el botón Categorías. Podés crearlas de monto fijo o de cantidad x valor con su unidad, y eliminar las que no uses. Son por empresa."),
        ("¿Puede pagar el sueldo otra empresa del grupo?",
         "Sí: al registrar el pago elegís Intercompany. Esta empresa le queda debiendo a la otra y se mueve el recurso real (caja/cheque/banco) de la que paga."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
