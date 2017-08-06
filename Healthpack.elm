import Html
import Material

-- An Elm program consists of a model, view and update handler,
-- which reacts to events by updating the model.
--
-- The elm runtime intelligently and efficiently renders the view
-- into the browser DOM, after each update.
--
main : Program Never Model Msg
main =
  Html.program
    { init = init
    , view = view
    , update = update
    , subscriptions = subscriptions
    }

-- MODEL
--
-- The model represents the application state.
--
-- Input from the browser updates the model.
-- Whenever the model changes, the view is updated.
--

type alias Model =
    { -- MDL model components
      mdl: Material.Model
    , windowSize: Window.Size
    , selectedTab: Int
      -- Playbook model components
    , motors: (Int, Int)
    , led: (Int, Int)
    }

type alias Mdl = Material.Model

type Msg
  = -- MDL messages
  | Mdl (Material.Msg Msg)
  -- Playbook application messages
  | GotWindowSize Window.Size
  | SetMotors (Maybe Int, Maybe Int)
  | BlinkLed (Int, Int)
  | Nop


-- model initialisation.
--
--
init : (Model, Cmd Msg)
init = (initialModel
       ! [ Material.init Update.Mdl
         , getWindowSize
         , blinkLed 500
         ])

initialModel : Model
initialModel =
    {
    -- MDL model components
      mdl = Material.model
    , windowSize = (Window.Size 0 0) -- window size not yet known
    , selectedTab = 0
    -- Playbook model components
    , motors = (0, 0)
    , led = (0, 0)
    }

-- SUBSCRIPTIONS

subscriptions : Model -> Sub Msg
subscriptions model =
    Sub.batch
        [ Window.resizes Update.GotWindowSize
        , Material.subscriptions Update.Mdl model
        ]

-- View function

view : Model -> Html Msg
view model = 
    -- let _ = Debug.log "Rendering" "Layout" in
    Layout.render Update.Mdl model.mdl
        [
        , Layout.fixedHeader
        -- , Layout.fixedDrawer
        -- , Layout.scrolling
        -- , Layout.transparentHeader
        ]
        { header = header    model
        , drawer = drawer    model
        , tabs   = tabs      model
        , main   = workspace model
        }


-- Update function

update : Msg -> Model -> (Model, Cmd Msg)
update msg model =
  case Debug.log "updating with msg" msg of
    -- Handling messages from the MDL framework

    Mdl msg_ ->
        Material.update Mdl msg_ model

    -- Handling messages from the browser

    SetMotors (left, right) ->
        let left_ = 
                case left of
                    Nothing -> model.leftMotor
                    Just l -> l
            right_ =
                case left of
                    Nothing -> model.leftMotor
                    Just l -> l
            model_ = 
		{ model | motors = (left_, right_)}
        in
            ( model_, Cmd.none )

        SetLed (rate, duty) ->
            

    -- Handling messages from init, and from event subscriptions

    GotWindowSize s ->
        ({model | windowSize = Debug.log "window size is " s}, Cmd.none)


    -- Handling responses from HTTP requests

    Nop ->
        ( model, Cmd.none )

-- Update helpers

-- Ask the browser how big the window is
getWindowSize : Cmd Msg
getWindowSize = Task.perform GotWindowSize Window.size

-- Make an AJAX request for a JSON resource (without decoding it)
getJsonString : String -> Http.Request String
getJsonString url =
    Http.request
      { method = "GET"
      , headers = [Http.header "Accept" "application/json"]
      , url = Debug.log "getJsonString: " url
      , body = Http.emptyBody
      , expect = Http.expectString
      , timeout = Nothing
      , withCredentials = False
      }

-- Make an AJAX request for JSON resource, and decode it with the supplied decoder
getJson : String -> Decoder a -> Http.Request a
getJson url decoder =
    Http.request
      { method = "GET"
      , headers = [Http.header "Accept" "application/json"]
      , url = Debug.log "getJson: " url
      , body = Http.emptyBody
      , expect = Http.expectJson decoder
      , timeout = Nothing
      , withCredentials = False
      }

-- View helpers

white : Options.Property c m
white = Color.text Color.white


header : Model -> List (Html Msg)
header model =
    [ Layout.row
          [ css "transition" "height 333ms ease-in-out 0s"
          -- , css "height" "75px"
          ]
          [ header_title model

          , Layout.spacer
          , Layout.navigation []
              [ Layout.link [ Layout.href "https://accelerando.com.au" ] [ text "accelerando.com.au" ]
              ]
          ]
    ]


header_title : Model -> Html Msg
header_title model =
    Layout.title []
        ( text "Hug All Humans" )

hamburger_button : Model -> Html Msg
hamburger_button model =
    Button.render Update.Mdl [0] model.mdl
        [ Button.icon ]
        [ Icon.i "menu" ]

drawer : Model -> List (Html Msg)
drawer model =
    [ Layout.title [ Options.onClick (Layout.toggleDrawer Update.Mdl)]
                   [ hamburger_button model , text "ElmBot" ]
    , drawer_body model
    ]

tabs : Model -> (List (Html Msg), List (Options.Style m))
tabs model = ( [], [] )

workspace : Model -> List (Html Msg)
workspace model =
    text "kill goes here"

    
